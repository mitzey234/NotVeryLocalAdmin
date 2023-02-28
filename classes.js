const fs = require("fs");
const path = require("path");
const axios = require('axios');
const { spawn } = require('child_process');
const EventEmitter = require("events");
var pty = require('node-pty');

var defaultSteamPath = [__dirname, "steam"];
var defaultServersPath = [__dirname, "servers"];

function joinPathArray (array) {
    var base = array.shift();
    for (i in array) {
        base = path.join(base, array[i]);
    }
    return base;
}


class ServerConfig {
    /** @type string */
    name;

    /** @type string */
    id;

    /** @type {import('child_process').ChildProcess } */
    process;

    /** @type number */
    port;

    /** @type Array<Plugin> */
    plugins;

    /** @type string */
    gameplayConfig;
    
    constructor () {

    }

}

class Server {
    /** @type {import('child_process').ChildProcess } */
    process;

    /** @type ServerConfig */
    config;

    constructor () {

    }
}

class executable {
    /** @type string */
    binaryPath;

}

class steamLogEvent {
    /** @type String */
    runId;

    /** @type String */
    log;

    /** @type Boolean */
    isError;

    constructor (runId, log, isError) {
        this.runId = runId;
        this.log = log;
        this.isError = isError;
    }
}

class steam extends EventEmitter{
    /** @type string */
    binaryPath;

    /** @type boolean */
    found;

    /** @type boolean */
    ready;

    /** @type NVLA */
    main;

    /** @type number */
    kbytesDownloaded;

    /** @type number */
    kbytesTotal;

    /** @type number */
    percentage;

    /** @type string */
    state;

    /** @type Array<Function> */
    queue = [];

    /** @type boolean */
    inUse;

    /** @type string */
    runId;

    /** @type Array<Function> */
    queue = [];

    constructor (nvla, overridePath) {
        super();
        this.main = nvla;
        this.main.log.bind(this)("Checking steam");
        var basePath = defaultSteamPath;
        if (overridePath) basePath = overridePath;
        if (Array.isArray(basePath)) basePath = joinPathArray(basePath);
        if (process.platform === 'win32') {
            this.binaryPath = path.join(basePath, "steamcmd.exe");
        } else if (process.platform === 'darwin') {
            this.binaryPath = path.join(basePath, "steamcmd");
        } else if (process.platform === 'linux') {
            this.binaryPath = path.join(basePath, "linux32/steamcmd");
        } else {
            throw 'Unsupported platform';
        }
        if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, {recursive: true});
    }


    /**
     * 
     * @param {String} runId 
     * @param {String} str 
     * @param {Boolean} isError 
     */
    async onstdout (runId, str, isError) {
        this.emit("log", new steamLogEvent(runId, str, isError));
        try {
            //this.main.log.bind(this)(`${str}`);
            if (str[0] == '[' && str[5] == ']') {
                var percent = str.substring(1,5).replace("%", "");
                if (percent == "----") percent = null;
                else percent = parseInt(percent);
                this.percentage = percent;
                this.emit("percentage", percent);
                this.state = str.substring(7, str.length);
                if (this.state.indexOf('(') > -1 && this.state.indexOf(')') > -1 && this.state.indexOf(" of ") > -1) this.state = this.state.replace(this.state.substring(this.state.indexOf('(')-1, this.state.indexOf(')')+1), "");
                this.main.log.bind(this)("Got current install state: " + this.percentage + " - " + this.state);
                this.emit("state", this.state);
                if (str.indexOf('(') > -1 && str.indexOf(')') > -1 && str.indexOf(" of ") > -1) {
                    let progress = str.substring(str.indexOf('(')+1, str.indexOf(')'));
                    progress = progress.replace(" KB", "").replaceAll(",", "").split(" of ");
                    this.kbytesDownloaded = parseInt(progress[0]);
                    this.kbytesTotal = parseInt(progress[1]);
                    this.emit("progress", {downloaded: this.kbytesDownloaded, total: this.kbytesTotal});
                }
            } else if (str.startsWith(" Update state") && str.indexOf("(") > -1 && str.indexOf(")") > -1) {
                this.state = str.substring(str.indexOf(') ')+2, str.indexOf(','));
                let alt = str.split(",")[1];
                this.percentage = parseFloat(alt.substring(alt.indexOf(': ')+2, alt.indexOf(' (')));
                this.emit("percentage", this.percentage);
                let progress = alt.substring(alt.indexOf('(')+1, alt.indexOf(')'));
                this.kbytesDownloaded = Math.floor(parseInt(progress.split(" / ")[0])/1000);
                this.kbytesTotal = Math.floor(parseInt(progress.split(" / ")[1])/1000);
                this.emit("progress", {downloaded: this.kbytesDownloaded, total: this.kbytesTotal});
                this.main.log.bind(this)("Got current install state: " + this.percentage + " - " + this.state + " - " + this.kbytesDownloaded + "/" + this.kbytesTotal);
            }
        } catch (e) {
            this.main.error.bind(this)("Error in steam stdout", e);
        }
    }

    async run (params) {
        this.main.log.bind("Steam binary path: " + this.binaryPath);

        var process = pty.spawn(this.binaryPath, params, {});
        
        process.on('data', function(data) {
            let d = data.toString().split("\n");
            for (i in d) {
                try {
                    this.onstdout(this.runId, d[i], true);
                } catch (e) {
                    this.main.error.bind(this)("Error in steam stdout", e);
                }
            }
        }.bind(this));


        let code = await new Promise(function (resolve, reject) {this.on("exit", resolve)}.bind(process));
        this.main.log.bind(this)("Steam binary finished with code:", code);
        if (code == 42) return this.run(params); //If exit code is 42, steamcmd updated and triggered magic restart
        else if (code == 0) return code;
        else {
            let error = "";
            if (code == 254) error = "Could not connect to steam for update";
            if (code == 5) error = "Login Failure";
            if (code == 8) error = "Failed to install";
            this.main.error.bind(this)("Steam execution failed:", code, error);
            return code;
        }
    }

    /**
     * Runs a steamcmd command immedately or puts it in the queue
     * @param {Array<String>} params 
     */
    async runWrapper (params, runId) {
        while (this.inUse) await new Promise(function (resolve, reject) {this.queue.push(resolve)}.bind(this));
        this.inUse = true;
        this.runId = runId;
        let result = null;
        this.emit("starting", runId);
        this.main.log.bind(this)("Running:", runId);
        try {
            result = await this.run(params);
        } catch (e) {
            this.main.log.bind(this)("Steam execution caused exception:", e);
        }
        this.inUse = false;
        this.runId = null;
        this.emit("finished", runId);
        if (this.queue.length > 0) this.queue.shift()();
        return result;
    }

    async check () {
        this.found = false;
        this.ready = false;
        if (!fs.existsSync(this.binaryPath)) {
            let result = await this.downloadSteamBinary(this.binaryPath);
            if (fs.existsSync(this.binaryPath)) {
                this.found = true;
                this.main.log.bind(this)("Steam binary found");
            } else {
                return result;
            }
        } else {
            this.found = true;
            this.main.log.bind(this)("Steam binary found");
        }
        let result = await this.runWrapper(['+login anonymous', '+quit'], 0);
        if (result == 0) this.ready = true;
        return result;
    }

    async downloadApp (appId, path, beta) {
        let result = await this.runWrapper(['+@sSteamCmdForcePlatformType linux', '+force_install_dir ' + ("\""+path+"\""), '+login anonymous', '+app_update ' + appId, (beta != null && beta.trim() != "" ? "-beta " + beta : ""), 'validate', '+quit'], Math.floor(Math.random()*10000000000));
        return result;
    }

    /**
     * Downloads and extracts the steamCMD binary for your supported platform
     */
    async downloadSteamBinary () {
        var basePath = path.parse(this.binaryPath).dir;
        if (process.platform === 'linux') basePath = path.join(basePath, "../");
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
        //url = "http://localhost:3000/"; //Temporary pls remove
        let buffer
        this.main.log.bind(this)("Requesting file: " + url);
        try {
            buffer = await axios({
                method: 'get',
                url: url,
                responseType: 'arraybuffer'
            });
            this.main.log.bind(this)("Downloaded compressed file");
        } catch (e) {
            this.main.error.bind(this)("Failed to download steam:", e.code);
            return -3;
        }
        this.main.log.bind(this)("Selecting decompression method");
        let extractor;
        if (process.platform != 'win32') {
            try {
                buffer = require("zlib").gunzipSync(buffer.data);
            } catch (e) {
                this.main.log.bind(this)("Failed to decompress zip:", e);
                return -1;
            }
            extractor = require('tar');
        } else {
            buffer = buffer.data;
            extractor = require('unzip');
        }
        this.main.log.bind(this)("Decompressing file: " + basePath);
        let writer = extractor.Extract({path: basePath});

        try {
            let obj = {resolve: function () {}, reject: function () {}};
            setTimeout(function () {
                writer.write(buffer);
                writer.end();
            }, 100);
            await new Promise(function (resolve, reject) {this.on("close", resolve); this.on("error", reject);}.bind(writer));
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
        this.config = require("./config.json");
        var serversPath = defaultServersPath;
        if (this.config.overrideServersPath && this.config.overrideServersPath.trim() != "") basePath = overridePath;
        if (Array.isArray(serversPath)) serversPath = joinPathArray(serversPath);
        if (!fs.existsSync(serversPath)) fs.mkdirSync(serversPath, {recursive: true});
        this.steam = new steam(this);
        let check = await this.steam.check();
        if ((this.steam.found != true) || (typeof(check) == "number" && check != 0) || !this.steam.ready) {
            this.log("Steam check failed:", check);
            process.exit();
        }
        this.log("Steam ready");
    }

    async getServers () {

    }

    log = function (...args) {
        console.log("[" + this.constructor.name + "]", ...args);
    }

    error = function (...args) {
        console.error("[" + this.constructor.name + "]", ...args);
    }
}

module.exports = {
    NVLA: NVLA
}