const StdLib = require('@doctormckay/stdlib');
const ByteBuffer = require('bytebuffer');
const AdmZip = require('adm-zip');
const LZMA = require('lzma');
const SteamCrypto = require('@doctormckay/steam-crypto');

const VZIP_HEADER = 0x5A56;
const VZIP_FOOTER = 0x767A;

process.on("message", function (m) {
    decode(m.sha, Buffer.from(m.res.data), Buffer.from(m.key.data));
});

async function decode (sha, data, key) {
    let decrypted = SteamCrypto.symmetricDecrypt(data, key);
    let result = await unzip(decrypted);
    let obj = {sha, result};
    process.send(obj);
}

function unzip(data) {
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