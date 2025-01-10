const StdLib = require('@doctormckay/stdlib');
const ByteBuffer = require('bytebuffer');
const AdmZip = require('adm-zip');
const LZMA = require('lzma');
const EventEmitter = require('events');
const SteamCrypto = require('@doctormckay/steam-crypto');
const { fork } = require('child_process');
let main;

const VZIP_HEADER = 0x5A56;
const VZIP_FOOTER = 0x767A;


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
		return new Promise((resolve, reject) => {
			// VZip or zip?
			if (data.readUInt16LE(0) != VZIP_HEADER) {
				// Standard zip
				let unzip = new AdmZip(data);
				return resolve(unzip.readFile(unzip.getEntries()[0]));
			} else {
				// VZip
				data = ByteBuffer.wrap(data, ByteBuffer.LITTLE_ENDIAN);
	
				data.skip(2); // header
				if (String.fromCharCode(data.readByte()) != 'a') {
					return reject(new Error('Expected VZip version \'a\''));
				}
	
				data.skip(4); // either a timestamp or a CRC; either way, forget it
				let properties = data.slice(data.offset, data.offset + 5).toBuffer();
				data.skip(5);
	
				let compressedData = data.slice(data.offset, data.limit - 10);
				data.skip(compressedData.remaining());
	
				let decompressedCrc = data.readUint32();
				let decompressedSize = data.readUint32();
				if (data.readUint16() != VZIP_FOOTER) {
					return reject(new Error('Didn\'t see expected VZip footer'));
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
						return reject(new Error('Decompressed size was not valid'));
					}
	
					if (StdLib.Hashing.crc32(result) != decompressedCrc) {
						return reject(new Error('CRC check failed on decompressed data'));
					}
	
					return resolve(result);
				});
			}
		});
	}
}

if (require.main === module) {
    process.on('SIGINT', () => {}); //Prevent the process from closing
    process.on('SIGTERM', () => {}); //Prevent the process from closing
    process.on('SIGUSR1', () => {}); //Prevent the process from closing
	main = new IDecoder();
	process.on("message", main.onMessage.bind(main));
}

module.exports = Decoder;