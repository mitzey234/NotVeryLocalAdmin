const fs = require("fs");
const path = require("path");
const axios = require('axios');

var defaultSteamPath = [__dirname, "steam"];

function joinPathArray (array) {
    var base = array.shift();
    for (i in array) {
        base = path.join(base, array[i]);
    }
    return base;
}

class steam {
    /** @type string */
    binaryPath;

    /** @type NVLA */
    main;

    constructor (nvla, overridePath) {
        this.main = nvla;
        this.main.log.bind(this)("Checking steam");
        var basePath = defaultSteamPath;
        if (overridePath) basePath = overridePath;
        if (Array.isArray(basePath)) basePath = joinPathArray(basePath);
        if (process.platform === 'win32') {
            this.binaryPath = path.join(basePath, "steamcmd");
        } else if (process.platform === 'darwin') {
            this.binaryPath = path.join(basePath, "steamcmd");
        } else if (process.platform === 'linux') {
            this.binaryPath = path.join(basePath, "steamcmd");
        } else {
            throw 'Unsupported platform';
        }
        if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, {recursive: true});
        if (!fs.existsSync(this.binaryPath)) this.downloadSteamBinary(basePath);
    }

    /**
     * Downloads and extracts the steamCMD binary for your supported platform
     * @param {string} basePath The path to install the steam binary into
     */
    async downloadSteamBinary (basePath) {
        this.main.log.bind(this)("Downloading steam binary");
        let url;
        if (process.platform === 'win32') {
            url = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
        } else if (process.platform === 'darwin') {
            url = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz'
        } else if (process.platform === 'linux') {
            url = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz'
        } else {
            throw 'Unsupported platform';
        }
        url = "http://localhost:3000/"; //Temporary pls remove
        let buffer
        try {
            buffer = await axios({
                method: 'get',
                url: url,
                responseType: 'arraybuffer'
            });
            this.main.log.bind(this)("Downloaded compressed file");
        } catch (e) {
            this.main.error.bind(this)("Failed to download steam:", e);
            return -3;
        }
        let extractor;
        if (process.platform != 'win32') {
            try {
                buffer = require("zlib").gunzipSync(buffer.data);
            } catch (e) {
                console.log("Failed to decompress zip:", e);
                return -1;
            }
            extractor = require('tar');
        } else {
            buffer = buffer.data;
            extractor = require('unzip');
        }
        try {
            let writer = extractor.Extract({path: basePath});
            writer.write(buffer);
            writer.end();
        } catch (e) {
            this.main.error.bind(this)("Failed extraction:", e);
            return -2;
        }
        this.main.log.bind(this)("Extraction complete");
        return 1;
    }
}

setInterval(() => {}, 1000);

class NVLA { 
    /** @type steam */
    steam;

    /** @type { import('./config.json')} */
    config;

    async start () {
        this.steam = await new steam(this);
        if (this.steam != 1) {
            process.exit();
        }
    }

    log = function (...args) {
        console.log("[" + this.constructor.name + "]",...args);
    }

    error = function (...args) {
        console.error("[" + this.constructor.name + "]", ...args);
    }
}

module.exports = {
    NVLA: NVLA
}