const fs = require("fs");
const path = require("path");
const axios = require('axios');
const { spawn } = require('child_process');
const EventEmitter = require("events");
const pty = require('node-pty');
const { Client } = require("./socket.js");
const pack = require("./package.json");
const crypto = require("crypto");
const messageHandler = require("./messageSystem.js");

var defaultSteamPath = [__dirname, "steam"];
var defaultServersPath = [__dirname, "servers"];

function joinPathArray (array) {
    var base = array.shift();
    for (i in array) {
        base = path.join(base, array[i]);
    }
    return base;
}

function md5 (string) {
    let hash = crypto.createHash("md5");
    hash.update(string);
    return hash.digest("hex");
}

class settings {
    /** @type string */
    serversFolder = path.join(__dirname, "servers");

    /** @type vegaSettings */
    vega;

    constructor () {
        if (!fs.existsSync(path.join(__dirname, "config.json"))) fs.writeFileSync(path.join(__dirname, "config.json"), "{}");
        let obj = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json")));
        this.vega = new vegaSettings(obj.vega);
        for (var i in obj) {
            if (i == "vega") continue;
            this[i] = obj[i];
        }
        fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(this, null, 4));
    }
}

class vegaSettings {
    /** @type string */
    host = "127.0.0.1";

    /** @type number */
    port = 5555;

    /** @type string */
    password = null;

    /** @type string */
    label = "Default";

    /** @type string */
    id = null;

    constructor (obj) {
        for (var i in obj) {
            this[i] = obj[i];
        }
    }
}

class ServerConfig {
  /** @type string */
  label = null;

  /** @type string */
  id = null;

  /** @type DedicatedFile[] */
  dedicatedFiles = [];

  /** @type string[] */
  plugins = [];

  /** @type string[] */
  customAssemblies = [];

  /** @type PluginFile[] */
  pluginFiles = [];

  /** @type string[] */
  dependencies = [];

  /** @type number */
  port = 0;

  /** @type string */
  verkey = null;

  /** @type string */
  assignedMachine = null;

  /** @type string */
  beta = null;

  /** @type string */
  betaPassword = null;

  /** @type Array<string> */
  installArguments = null;

}

class Server {
    /** @type {import('child_process').ChildProcess } */
    process;

    /** @type NVLA */
    main;

    /** @type ServerConfig */
    config;

    /** @type string */
    pluginsFolderPath;

    /** @type string */
    serverConfigsFolder;

    /** @type string */
    serverCustomAssembliesFolder;

    /** @type string */
    serverInstallFolder;

    /**
     * @param {NVLA} main
     * @param {ServerConfig} config
     */
    constructor (main, config) {
        this.main = main;
        this.config = config;
        this.pluginsFolderPath = path.join(this.main.config.serversFolder, this.config.id, "SCP Secret Laboratory", "PluginAPI", "plugins", "global");
        this.serverConfigsFolder = path.join(this.main.config.serversFolder, this.config.id, "SCP Secret Laboratory", "config", config.port.toString());
        this.serverInstallFolder = path.join(this.main.config.serversFolder, this.config.id, "scpsl");
        this.serverCustomAssembliesFolder = path.join(this.serverInstallFolder, "SCPSL_Data", "Managed");
    }

    async install() {
        this.main.log.bind(this)("Configuring server " + this.config.label, this.config);
        try {
            let result = await this.main.steam.downloadApp("996560", this.serverInstallFolder, this.config.beta, this.config.betaPassword, this.config.installArguments);
            if (result != 0) throw "Failed to install server";
            this.main.log.bind(this)("Installed SCPSL");
        } catch (e) {
            this.main.error.bind(this)("Failed to install server: " + e);
            return;
        }
    }
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

        let proc = pty.spawn(process.platform === 'win32' ? 'powershell.exe' : 'bash', [], {
            cwd: path.parse(this.binaryPath).dir,
            env: process.env
        });

        proc.write(this.binaryPath+" "+params.join(" ")+"\r");
        proc.write(process.platform === 'win32' ? "exit $LASTEXITCODE\r" : 'exit $?\r');
        
        proc.on('data', function(data) {
            let d = data.toString().split("\n");
            for (i in d) {
                try {
                    this.onstdout(this.runId, d[i], true);
                } catch (e) {
                    this.main.error.bind(this)("Error in steam stdout", e);
                }
            }
        }.bind(this));


        let code = await new Promise(function (resolve, reject) {this.on("exit", resolve)}.bind(proc));
        this.main.log.bind(this)("Steam binary finished with code:", code);
        if (code == 42 || code == 7) {
            this.main.log.bind(this)("Steam binary updated, restarting");
            return this.run(params); //If exit code is 42, steamcmd updated and triggered magic restart
        }
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

    async downloadApp (appId, path, beta, betaPassword, customArgs) {
        let result = await this.runWrapper([(customArgs != null ? customArgs.join(" ") : ""), '+force_install_dir ' + ("\""+path+"\""), '+login anonymous', '+app_update ' + appId, (beta != null && beta.trim() != "" ? "-beta " + beta + (betaPassword != null && betaPassword.trim() != "" ? "-betapassword " + betaPassword : "") : ""), 'validate', '+quit'], Math.floor(Math.random()*10000000000));
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
        if (process.platform != 'win32') {
            try {
                buffer = require("zlib").gunzipSync(buffer.data);
            } catch (e) {
                this.main.log.bind(this)("Failed to decompress zip:", e);
                return -1;
            }
            extractor = require('tar');
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
        } else {
            buffer = buffer.data;
            const AdmZip = require('adm-zip');
            try {
                this.main.log.bind(this)("Decompressing file: " + basePath);
                let zip = new AdmZip(buffer);
                zip.extractAllTo(basePath, true, true);
                console.log('Extraction complete');
            } catch (err) {
                this.main.error.bind(this)("Failed extraction:", e);
                return -2;
            }
        }
        return 1;
    }
}

setInterval(() => {}, 1000);

class ServerManager extends EventEmitter {

    /** @type Map<String,Server> */
    servers = new Map();

    constructor () {
        super();
    }

    loadLocalConfiguration () {
        
    }

}

class NVLA { 
    /** @type steam */
    steam;

    /** @type settings */
    config;

    /** @type { import('./socket.js')["Client"]} */
    client;

    /** @type Vega */
    vega;

    /** @type ServerManager */
    ServerManager;

    async start () {
        this.config = new settings();
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
        this.ServerManager = new ServerManager();
        this.ServerManager.loadLocalConfiguration();
        this.vega = new Vega(this);
        this.vega.connect();

    }

    log = function (...args) {
        console.log("[" + this.constructor.name + "]", ...args);
    }

    error = function (...args) {
        console.error("[" + this.constructor.name + "]", ...args);
    }
}

class Vega {
    /** @type {NVLA} */
    main;

    /** @type { import('./config.json')} */
    config;

    /** @type { import('./socket.js')["Client"]} */
    client;

    /** @type {Map<string, {resolve: function, reject: function}>} */
    fileRequests = new Map();

    /** @type {messageHandler} */
    messageHandler;

    /**
     * @param {NVLA} main
     */
    constructor(main) {
        this.main = main;
        this.log = main.log;
        this.error = main.error;
        this.config = main.config;
        this.messageHandler = new messageHandler(this, module.exports);
    }

    async connect () {
        this.log.bind(this)("Connecting to Vega");
        this.client = new Client();
        this.client.connect({ port: this.config.vega.port, host: this.config.vega.host });
        this.client.on('message', this.onMessage.bind(this));
        this.client.on('connect', this.onConnect.bind(this));
        this.client.on('close', this.onClose.bind(this));
        this.client.on('error', this.onError.bind(this));
    }

    async onConnect () {
        this.client.sendMessage({"type": "auth", "token": this.config.vega.password, "id": this.config.vega.id, "label": this.config.vega.label, "version": pack.version});
    }

    serverTimeout () {
        this.log.bind(this)("Vega Connection timed out");
        this.client.destroy();
    }

    async onMessage (m, s) {
        try {
            this.messageHandler.handle(m, s);
        } catch (e) {
            this.error.bind(this)("Failed to handle message:", e + "\n" + m);
        }
    }

    randomFileRequestId () {
        let id = Math.random().toString(36).slice(2);
        if (this.fileRequests.has(id)) return randomId();
        return id;
    }

    async onAuthenticated () {
        try {
            //let data = await this.getFile("customAssembly", "Assembly-CSharp");
            //console.log("Got file:", data);
        } catch (e) {
            console.log("Error getting file: " + e);
        }
    }

    async getFile (type, file) {
        this.log.bind(this)("Requesting "+type+": "+file);
        return new Promise((resolve, reject) => {
            let id = this.randomFileRequestId();
            this.fileRequests.set(id, {resolve: resolve, reject: reject});
            this.client.sendMessage({type: "fileRequest", id: id, fileType: type, file: file});
        });
    }

    async onClose () {
        this.log.bind(this)("Vega Connection closed, reconnecting in 5 seconds");
        setTimeout(this.connect.bind(this), 5000);
        if (this.client.pingSystem != null) this.client.pingSystem.destroy();
        this.fileRequests.forEach((v, k) => {
            v.reject("Vega Connection closed");
            this.fileRequests.delete(k);
        });
    }
    
    async onError (e) {
        this.error.bind(this)("Vega Connection error:", e);
    }

    async getServers () {

    }
}

module.exports = {
    NVLA: NVLA,
    Vega: Vega,
    ServerConfig: ServerConfig,
    Server: Server
}