const StdLib = require('@doctormckay/stdlib');
const ByteBuffer = require('bytebuffer');
const AdmZip = require('adm-zip');
const LZMA = require('lzma');
const EventEmitter = require('events');
const SteamCrypto = require('@doctormckay/steam-crypto');
const { fork } = require('child_process');
const test = require('@mongodb-js/zstd');
let main;

const HEADER_ZSTD = 'VSZa';
const HEADER_VZIP = 'VZa';
const HEADER_ZIP = 'PK\u0003\u0004';

const FOOTER_ZSTD = 'zsv';
const FOOTER_VZIP = 'zv';


class Decoder extends EventEmitter {
	stopping = false;

	sha;

	data;

	key;

	restartCount = 0;

	/** @type {{resolve: Function, reject: Function}} */
    promise;

	hook (sha, data, key) {
		let temp = new Promise((r, rej) => this.promise = {resolve: r, reject: rej});
		let obj = {sha, data, key};
		this.sha = sha;
		this.data = data;
		this.key = key;
		this.process.send(obj);
        return temp;
	}

	onExit () {
        this.process = null;
        if (!this.stopping) this.init();
    }

	constructor () {
        super();
        this.init();
    }

	init () {
        if (this.process != null) this.stop();
        this.stopping = false;
        this.process = fork(__filename);
        this.process.on("exit", this.onExit.bind(this));
        this.process.on("message", this.onMessage.bind(this));
		if (this.promise != null) {
			if (this.data != null && this.sha != null && this.key != null && this.restartCount <= 3) {
				this.restartCount++;
				let obj = {sha: this.sha, data: this.data, key: this.key};
				this.process.send(obj);
			} else if (this.data != null && this.sha != null && this.key != null) {
				this.promise.reject(new Error("Decompression worker exited unexpectedly after multiple tries"));
				this.promise = null;
				let sha = this.sha;
				this.emit("finish", sha);
			} else {
				this.promise.reject(new Error("Decompression worker exited unexpectedly and could not be recovered"));
				this.promise = null;
				let sha = this.sha;
				this.emit("finish", sha);
			}
		} else if (this.data != null || this.sha != null || this.key != null) {
			this.reset();
		}
    }

	reset () {
		this.sha = null;
		this.data = null;
		this.key = null;
		this.restartCount = 0;
	}

	onMessage(m) {
		if (m.result != null) {
			let sha = this.sha;
			this.reset();
			this.promise.resolve(Buffer.from(m.result.data));
			this.emit("finish", sha);
		} else if (m.error != null) {
			let sha = this.sha;
			this.reset();
			let err = new Error(m.error);
			err.stack = m.stack;
			this.promise.reject(err);
			this.emit("finish", sha);
		}
	}

	stop () {
		if (this.process == null) return;
		this.stopping = true;
		this.process.kill(9);
		this.process = null;
		this.reset();
	}
}

class IDecoder extends EventEmitter {

	onMessage (m) {
		this.decode(m.sha, Buffer.from(m.data.data), Buffer.from(m.key));
	}

	async decode (sha, data, key) {
		//console.log("Decoding:", sha);
		try {
			let decrypted = SteamCrypto.symmetricDecrypt(data, key);
			let result = await this.unzip(decrypted);
			let obj = {result};
			process.send(obj);
		} catch (err) {
			process.send({error:  (err.code || err.message), stack: err.stack});
		}
	}
	
	unzip(data) {
		let headerString = data.slice(0, 4).toString('utf8');

		if (headerString.startsWith(HEADER_ZSTD)) {
			return decompressZstd(data);
		}

		if (headerString.startsWith(HEADER_VZIP)) {
			return decompressVzip(data);
		}

		if (headerString.startsWith(HEADER_ZIP)) {
			return decompressZip(data);
		}
		throw new Error(`Unknown compression type: ${headerString} (${data.slice(0, 4).toString('hex')})`);
	}
}

function decompressZstd(data) {
	return new Promise((resolve, reject) => {
		let buffer = ByteBuffer.wrap(data, ByteBuffer.LITTLE_ENDIAN);

		if (buffer.readUTF8String(HEADER_ZSTD.length) != HEADER_ZSTD) {
			return reject(new Error('Zstd: Didn\'t see expected header'));
		}

		buffer.skip(4); // CRC but we don't really care, there's another one anyway
		let compressedData = buffer.slice(buffer.offset, buffer.limit - 15);
		buffer.skip(compressedData.remaining());

		let decompressedCrc = buffer.readUint32();
		let decompressedSize = buffer.readUint32();
		buffer.skip(4); // 0-padding
		if (buffer.readUTF8String(FOOTER_ZSTD.length) != FOOTER_ZSTD) {
			return reject(new Error('Zstd: Didn\'t see expected footer'));
		}

		test.decompress(compressedData.toBuffer()).then((result) => {
			// Verify the result
			if (decompressedSize != result.length) {
				return reject(new Error('Zstd: Decompressed size was not valid'));
			}

			if (StdLib.Hashing.crc32(result) != decompressedCrc) {
				return reject(new Error('Zstd: CRC check failed on decompressed data'));
			}

			return resolve(result);
		}).catch((err) => {
			return reject(err);
		});
	});
}

function decompressVzip(data) {
	return new Promise((resolve, reject) => {
		let buffer = ByteBuffer.wrap(data, ByteBuffer.LITTLE_ENDIAN);

		if (buffer.readUTF8String(HEADER_VZIP.length) != HEADER_VZIP) {
			return reject(new Error('VZip: Didn\'t see expected header'));
		}

		buffer.skip(4); // either a timestamp or a CRC; either way, don't care
		let properties = buffer.slice(buffer.offset, buffer.offset + 5).toBuffer();
		buffer.skip(5);

		let compressedData = buffer.slice(buffer.offset, buffer.limit - 10);
		buffer.skip(compressedData.remaining());

		let decompressedCrc = buffer.readUint32();
		let decompressedSize = buffer.readUint32();
		if (buffer.readUTF8String(FOOTER_VZIP.length) != FOOTER_VZIP) {
			return reject(new Error('VZip: Didn\'t see expected footer'));
		}

		let uncompressedSizeBuffer = Buffer.alloc(8);
		uncompressedSizeBuffer.writeUInt32LE(decompressedSize, 0);
		uncompressedSizeBuffer.writeUInt32LE(0, 4);

		LZMA.decompress(Buffer.concat([properties, uncompressedSizeBuffer, compressedData.toBuffer()]), (result, err) => {
			if (err) {
				return reject(err);
			}

			result = Buffer.from(result); // it's a byte array

			// Verify the result
			if (decompressedSize != result.length) {
				return reject(new Error('VZip: Decompressed size was not valid'));
			}

			if (StdLib.Hashing.crc32(result) != decompressedCrc) {
				return reject(new Error('VZip: CRC check failed on decompressed data'));
			}

			return resolve(result);
		});
	});
}

function decompressZip(data) {
	let unzip = new AdmZip(data);
	return unzip.readFile(unzip.getEntries()[0]);
}

if (require.main === module) {
    process.on('SIGINT', () => {}); //Prevent the process from closing
    process.on('SIGTERM', () => {}); //Prevent the process from closing
    process.on('SIGUSR1', () => {}); //Prevent the process from closing
	main = new IDecoder();
	process.on("message", main.onMessage.bind(main));
}

module.exports = Decoder;