const FS = require('fs');
const crypto = require('crypto');

const States = {
    Connecting: 0,
    Ready: 1,
    Disconnected: 2,
    Downloading: 3,
    GettingAppInfo: 4,
    GettingDepots: 5,
    GettingManifests: 6,
    GettingKeys: 7,
    GettingServers: 8,
    StartingWorkers: 9,
    Destroying: 10
}

const StateStrings = {};
for (let i in States) StateStrings[States[i]] = i;

const SteamOSs = {
    darwin: "macos",
    linux: "linux",
    win32: "windows"
}

function len (obj) {
    return Object.keys(obj).length;
}

function fileHash (path) {
	return new Promise((resolve, reject) => {
		let hash = crypto.createHash('sha1');
		let stream = FS.createReadStream(path);
		stream.on('error', reject);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function getHash (buffer) {
	return crypto.createHash('sha1').update(buffer).digest('hex');
}

module.exports = {
    SteamOSs,
    len,
    fileHash,
    getHash,
    States,
    StateStrings
};