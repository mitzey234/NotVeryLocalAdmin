const fs = require("fs");
const path = require("path");
const axios = require('axios');
const { spawn } = require('child_process');
const EventEmitter = require("events");
const pty = require('node-pty');
const { Client } = require("./socket.js");
const pack = require("./package.json");
const crypto = require("crypto");
const Net = require('net');
const messageHandler = require("./messageSystem.js");
const mt = require("./messageTemplates.js");
const chokidar = require('chokidar');
const chalk = require('chalk');

var defaultSteamPath = [__dirname, "steam"];
var defaultServersPath = [__dirname, "servers"];

function isDir (target) {
    //console.log("Reading is folder:", target);
    try {
        fs.readdirSync(target);
        return true;
    } catch (e) {
        //console.log(e);
        return false;
    }
}

function joinPaths (arr) {
    var p = '';
    for (var i in arr) {
        p = path.join(p, arr[i]);
    }
    return p;
}

function getIgnores(folder) {
    if (fs.existsSync(path.join(folder, ".ignore"))) {
        try {
            let data = fs.readFileSync(path.join(folder, ".ignore")).toString().replaceAll("\r", "");
            return data.split("\n");
        } catch (e) {
            console.log(".ignore error:", e);
            return [];
        }
    } else {
        return [];
    }
}

function isIgnored(root, file) {
    let filename = path.parse(file).base;
    let ignores = getIgnores(path.parse(file).dir);
    if (ignores.includes(filename)) return true;
    if (path.relative(root, path.parse(file).dir) == "") return false;
    return isIgnored(root, path.parse(file).dir);
}

function md5 (string) {
    let hash = crypto.createHash("md5");
    hash.update(string);
    return hash.digest("hex");
}

function readFolder(root, p = [], includeDirs = false) {
    if (p == null) p = [];
    var list = fs.readdirSync(path.join(root, joinPaths(p)));
    var files = [];
    for (i in list) {
        var target = path.join(root, joinPaths(p), list[i]);
        var targetStats = fs.statSync(target);
        if (targetStats.isDirectory() && isDir(target)) {
            if (includeDirs) files.push({filename: list[i], p: p, size: null, isDir: true});
            files = files.concat(readFolder(root, p.concat([list[i]]), includeDirs));
        } else {
            var o = {filename: list[i], p: p, size: targetStats.size};
            files.push(o);
        }
    }
    return files;
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

  /** @type string[] */
  plugins = [];

  /** @type string[] */
  customAssemblies = [];

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

  /** @type boolean */
  autoStart = false;

}


let ServerStates = {
    STOPPED: 0,
    STARTING: 1,
    RUNNING: 2,
    STOPPING: 3,
    UPDATING: 4,
    INSTALLING: 5,
    UNINSTALLING: 6,
    RESTARTING: 7,
    CONFIGURING: 8,
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

    /** @type boolean */
    installed = false;

    /** @type boolean */
    updatePending = false;

    /** @type {import("child_process")["ChildProcess"]["prototype"]} */
    process;

    /** @type import("chokidar")["FSWatcher"]["prototype"] */
    pluginsFolderWatch;

    /** @type import("chokidar")["FSWatcher"]["prototype"] */
    configFolderWatch;

    /** boolean */
    disableWatching = false;

    ignoreFilePaths = [];

    /** @type number */
    state = 0;

    /** @type number */
    uptime = 0;

    /** @type Array<string> */
    players;


    /**
     * @param {NVLA} main
     * @param {ServerConfig} config
     */
    constructor (main, config) {
        this.main = main;
        this.config = config;
        this.serverContainer = path.join(this.main.config.serversFolder, this.config.id);
        this.serverInstallFolder = path.join(this.serverContainer, "scpsl");
        this.dedicatedServerAppdata = path.join(this.serverInstallFolder, "AppData", "SCP Secret Laboratory");
        this.pluginsFolderPath = path.join(this.dedicatedServerAppdata, "PluginAPI", "plugins", "global");
        this.serverConfigsFolder = path.join(this.serverInstallFolder, "AppData", "config", config.port.toString());
        this.serverCustomAssembliesFolder = path.join(this.serverInstallFolder, "SCPSL_Data", "Managed");

        try {
            if (!fs.existsSync(this.pluginsFolderPath)) fs.mkdirSync(this.pluginsFolderPath, {recursive: true});
            if (!fs.existsSync(this.serverConfigsFolder)) fs.mkdirSync(this.serverConfigsFolder, {recursive: true});
            this.setupWatchers();
        } catch (e) {
            this.main.error.bind(this)("Failed to create folders: " + e);
        }
    }

    async setupWatchers () {
        await this.stopWatchers();
        this.pluginsFolderWatch = chokidar.watch(this.pluginsFolderPath, {ignoreInitial: true, persistent: true});
        this.pluginsFolderWatch.on('all', this.onPluginConfigFileEvent.bind(this));
        this.pluginsFolderWatch.on('error', this.main.error.bind(this));
        this.configFolderWatch = chokidar.watch(this.serverConfigsFolder, {ignoreInitial: true, persistent: true});
        this.configFolderWatch.on('all', this.onConfigFileEvent.bind(this));
        this.configFolderWatch.on('error', this.main.error.bind(this));
    }

    async stopWatchers () {
        if (this.pluginsFolderWatch != null){
            await this.pluginsFolderWatch.close();
            this.pluginsFolderWatch = null;
        }
        if (this.configFolderWatch != null){
            await this.configFolderWatch.close();
            this.configFolderWatch = null;
        }
    }

    async onConfigFileEvent (event, filePath) {
        if (this.disableWatching) return;
        filePath = path.relative(this.serverConfigsFolder, filePath);
        if (isIgnored(this.serverConfigsFolder, path.join(this.serverConfigsFolder, filePath))) return;
        if (this.ignoreFilePaths.includes(filePath)) return this.ignoreFilePaths = this.ignoreFilePaths.filter(x => x != filePath);
        if (event == "add" || event == "change") {
            this.main.vega.client.sendMessage(new mt.updateConfigFile(this.config.id, filePath, fs.readFileSync(path.join(this.serverConfigsFolder, filePath)).toString("base64")));
        } else if (event == "unlink") {
            this.main.vega.client.sendMessage(new mt.removeConfigFile(this.config.id, filePath));
        }
        //console.log("Config file event: " + event + " " + filePath);
    }

    async onPluginConfigFileEvent (event, filePath) {
        if (this.disableWatching) return;
        filePath = path.relative(this.pluginsFolderPath, filePath);
        if (isIgnored(this.pluginsFolderPath, path.join(this.pluginsFolderPath, filePath))) return;
        if (filePath.startsWith("dependencies") || filePath.endsWith(".dll")) return;
        if (this.ignoreFilePaths.includes(filePath)) return this.ignoreFilePaths = this.ignoreFilePaths.filter(x => x != filePath);
        if (event == "add" || event == "change") {
            this.main.vega.client.sendMessage(new mt.updatePluginConfigFile(this.config.id, filePath, fs.readFileSync(path.join(this.pluginsFolderPath, filePath)).toString("base64")));
        } else if (event == "unlink") {
            this.main.vega.client.sendMessage(new mt.removePluginConfigFile(this.config.id, filePath));
        }
        //console.log("Plugin config file event: " + event + " " + filePath);
    }

    async getPluginConfigFiles () {
        /** @type {File[]} */
        let files;
        try {
            files = await this.main.vega.getPluginConfiguration(this.config.id);
        } catch (e) {
            this.main.error.bind(this)("Failed to get plugin configs: " + e);
        }
        let usedFolders = ['dependencies'];
        for (var x in files) {
            /** @type {File} */
            let file = files[x];
            let filePath = path.join(this.pluginsFolderPath, file.path);
            if (!usedFolders.includes(path.parse(file.path).dir)) usedFolders.push(path.parse(file.path).dir);
            this.main.log.bind(this)("Writing: " + file.path);
            try {
                fs.mkdirSync(path.parse(filePath).dir, {recursive: true});
            } catch (e) {
                this.main.error.bind(this)("Failed to create plugin config directory: " + e);
                continue;
            }
            try {
                this.ignoreFilePaths.push(file.path);
                fs.writeFileSync(filePath, file.data, {encoding: "base64"});
            } catch (e) {
                this.main.error.bind(this)("Failed to write plugin config file: " + e);
                continue;
            }
        }
        /** @type Array<> */
        var currentFiles = readFolder(this.pluginsFolderPath, null, true);
        let folders = currentFiles.filter(x => x.isDir);
        currentFiles = currentFiles.filter(x => !x.isDir);
        for (var i in currentFiles) {
            let file = currentFiles[i];
            let safe = false;
            for (x in files) {
                let alt = files[x];
                if (path.join(joinPaths(file.p) || "./", file.filename) == alt.path) {
                    safe = true;
                    break;
                }
            }
            try {
                if (!isIgnored(this.pluginsFolderPath, path.join(this.pluginsFolderPath, joinPaths(file.p) || "", file.filename)) && !safe && !path.join(joinPaths(file.p) || "", file.filename).startsWith("dependencies") && !(file.filename.endsWith(".dll") && path.parse(path.join(joinPaths(file.p) || "", file.filename)).dir == '')) {
                    this.main.log.bind(this)("Deleting: " + path.join(joinPaths(file.p) || "", file.filename));
                    this.ignoreFilePaths.push(path.join(joinPaths(file.p) || "", file.filename));
                    fs.rmSync(path.join(this.pluginsFolderPath, joinPaths(file.p) || "", file.filename), {recursive: true});
                }
            } catch (e) {
                this.main.error.bind(this)("Failed to delete unneeded plugin config file: ",  e);
                continue;
            }
        }
        for (i in folders) {
            if (usedFolders.includes(path.join(joinPaths(folders[i].p), folders[i].filename)) || isIgnored(this.pluginsFolderPath, path.join(this.pluginsFolderPath, joinPaths(folders[i].p) || "", folders[i].filename))) continue;
            this.main.log.bind(this)("Deleting: " + path.join(joinPaths(folders[i].p) || "", folders[i].filename));
            try {
                fs.rmSync(path.join(this.pluginsFolderPath, joinPaths(folders[i].p) || "", folders[i].filename), {recursive: true});
            } catch (e) {
                this.main.error.bind(this)("Failed to delete unneeded plugin config folder: ",  e);
                continue;
            }
        }
        this.main.log.bind(this)("Wrote plugin configs");
    }

    async getPlugins () {
        for (var i in this.config.plugins) {
            let plugin = this.config.plugins[i];
            /** @type {File} */
            let pluginData;
            try {
                pluginData = await this.main.vega.getPlugin(plugin);
                fs.writeFileSync(path.join(this.pluginsFolderPath, plugin + ".dll"), Buffer.from(pluginData.data, "base64"));
            } catch (e) {
                this.main.error.bind(this)("Failed to get plugin '"+ plugin +"': " + e);
                continue;
            }
        }
        let files = fs.readdirSync(this.pluginsFolderPath);
        for (var i in files) {
            let file = files[i];
            if (file.endsWith(".dll") && !this.config.plugins.includes(file.replace(".dll", ""))) {
                this.main.log.bind(this)("Deleting: " + file);
                try {
                    fs.rmSync(path.join(this.pluginsFolderPath, file), {recursive: true});
                } catch (e) {
                    this.main.error.bind(this)("Failed to delete unneeded plugin: ",  e);
                    continue;
                }
            }
        }
        this.main.log.bind(this)("Installed plugins");
    }

    async getCustomAssemblies () {
        for (var i in this.config.customAssemblies) {
            let customAssembly = this.config.customAssemblies[i];
            /** @type {File} */
            let customAssemblyData;
            try {
                customAssemblyData = await this.main.vega.getCustomAssembly(customAssembly);
                fs.writeFileSync(path.join(this.serverCustomAssembliesFolder, customAssembly + ".dll"), Buffer.from(customAssemblyData.data, "base64"));
            } catch (e) {
                this.main.error.bind(this)("Failed to get custom assembly '"+ customAssembly +"': " + e);
                continue;
            }
        }
        this.main.log.bind(this)("Installed custom Assemblies");
    }

    async getDependencies () {
        let targetFolder = path.join(this.pluginsFolderPath, "dependencies");
        try {
            if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, {recursive: true});
        } catch (e) {
            this.main.error.bind(this)("Failed to create dependencies folder: " + e);
            return;
        }
        for (var i in this.config.dependencies) {
            let dependency = this.config.dependencies[i];
            /** @type {File} */
            let dependencyData;
            try {
                dependencyData = await this.main.vega.getDependency(dependency);
                fs.writeFileSync(path.join(targetFolder, dependency + ".dll"), Buffer.from(dependencyData.data, "base64"));
            } catch (e) {
                this.main.error.bind(this)("Failed to get dependency '"+ dependency +"': " + e);
                continue;
            }
        }
        this.main.log.bind(this)("Installed dependencies");
    }

    async getDedicatedServerConfigFiles () {
        /** @type {File[]} */
        let files;
        try {
            files = await this.main.vega.getDedicatedServerConfiguration(this.config.id);
        } catch (e) {
            this.main.error.bind(this)("Failed to get plugin configs: " + e);
        }
        let usedFolders = [];
        for (var x in files) {
            /** @type {File} */
            let file = files[x];
            let filePath = path.join(this.serverConfigsFolder, file.path);
            if (!usedFolders.includes(path.parse(file.path).dir)) usedFolders.push(path.parse(file.path).dir);
            this.main.log.bind(this)("Writing: " + file.path);
            try {
                fs.mkdirSync(path.parse(filePath).dir, {recursive: true});
            } catch (e) {
                this.main.error.bind(this)("Failed to create dedicated server config directory: " + e);
                continue;
            }
            try {
                this.ignoreFilePaths.push(file.path);
                fs.writeFileSync(filePath, file.data, {encoding: "base64"});
            } catch (e) {
                this.main.error.bind(this)("Failed to write dedicated server config file: " + e);
                continue;
            }
        }
        /** @type Array<> */
        var currentFiles = readFolder(this.serverConfigsFolder, null, true);
        let folders = currentFiles.filter(x => x.isDir);
        currentFiles = currentFiles.filter(x => !x.isDir);
        for (var i in currentFiles) {
            let file = currentFiles[i];
            let safe = false;
            for (x in files) {
                let alt = files[x];
                if (path.join(joinPaths(file.p) || "./", file.filename) == alt.path) {
                    safe = true;
                    break;
                }
            }
            try {
                if (!safe) {
                    this.main.log.bind(this)("Deleting: " + path.join(joinPaths(file.p) || "", file.filename));
                    this.ignoreFilePaths.push(path.join(joinPaths(file.p) || "", file.filename));
                    fs.rmSync(path.join(this.serverConfigsFolder, joinPaths(file.p) || "", file.filename), {recursive: true});
                }
            } catch (e) {
                this.main.error.bind(this)("Failed to delete unneeded dedicated server config file: ",  e);
                continue;
            }
        }
        for (i in folders) {
            if (usedFolders.includes(path.join(joinPaths(folders[i].p), folders[i].filename))) continue;
            this.main.log.bind(this)("Deleting: " + path.join(joinPaths(folders[i].p) || "", folders[i].filename));
            try {
                fs.rmSync(path.join(this.serverConfigsFolder, joinPaths(folders[i].p) || "", folders[i].filename), {recursive: true});
            } catch (e) {
                this.main.error.bind(this)("Failed to delete unneeded dedicated server config folder: ",  e);
                continue;
            }
        }
        this.main.log.bind(this)("Wrote dedicated server configs");        
    }

    async configure () {
        let oldState = this.state;
        this.setState(ServerStates.CONFIGURING);
        this.main.log.bind(this)("Configuring server " + this.config.label);
        try {
            await this.getPluginConfigFiles();
        } catch (e) {
            this.main.error.bind(this)("Failed to get plugin configs:", e);
            return;
        }
        try {
            await this.getDependencies();
        } catch (e) {
            this.main.error.bind(this)("Failed to get dependencies:", e);
            return;
        }
        try {
            await this.getPlugins();
        } catch (e) {
            this.main.error.bind(this)("Failed to get plugins:", e);
            return;
        }
        try {
            await this.getCustomAssemblies();
        } catch (e) {
            this.main.error.bind(this)("Failed to get custom assemblies:", e);
            return;
        }
        try {
            await this.getDedicatedServerConfigFiles();
        } catch (e) {
            this.main.error.bind(this)("Failed to get dedicated server configs:", e);
            return;
        }
        if (this.config.verkey != null && this.config.verkey.trim() != "") {
            try {
                fs.writeFileSync(path.join(this.dedicatedServerAppdata, "verkey.txt"), this.config.verkey);
            } catch (e) {
                this.main.error.bind(this)("Failed to write verkey.txt:", e);
            }
        } else {
            try {
                if (fs.existsSync(path.join(this.dedicatedServerAppdata, "verkey.txt"))) fs.rmSync(path.join(this.dedicatedServerAppdata, "verkey.txt"));
            } catch (e) {
                this.main.error.bind(this)("Failed to delete verkey.txt:", e);
            }
        }
        fs.writeFileSync(path.join(this.serverInstallFolder, "hoster_policy.txt"), "gamedir_for_configs: true");
        if (this.process != null) this.updatePending = true;
        if (this.state == ServerStates.CONFIGURING) this.setState(oldState);
        if (this.config.autoStart && this.process == null) this.start();
    }

    async install() {
        this.main.log.bind(this)("Installing server " + this.config.label);
        try {
            let result = await this.main.steam.downloadApp("996560", this.serverInstallFolder, this.config.beta, this.config.betaPassword, this.config.installArguments);
            if (result != 0) throw "Failed to install server";
            this.main.log.bind(this)("Installed SCPSL");
            this.installed = true;
        } catch (e) {
            this.main.error.bind(this)("Failed to install server:", e);
            return;
        }
        await this.configure();
    }

    async uninstall () {
        this.disableWatching = true;
        await this.stopWatchers();
        this.main.log.bind(this)("Uninstalling server " + this.config.label);
        if (this.process != null) await this.stop(true);
        fs.rmSync(this.serverContainer, {recursive: true});
    }

    async update () {
        if (this.state == ServerStates.UPDATING) return;
        let oldState = this.state;
        this.setState(ServerStates.UPDATING);
        this.main.log.bind(this)("Updating server " + this.config.label, this.config);
        try {
            let result = await this.main.steam.downloadApp("996560", this.serverInstallFolder, this.config.beta, this.config.betaPassword, this.config.installArguments);
            if (result != 0) throw "Failed to update server";
            this.main.log.bind(this)("Updated SCPSL");
            if (this.process != null) this.updatePending = true;
        } catch (e) {
            this.main.error.bind(this)("Failed to install server: " + e);
            return;
        }
        try {
            await this.getCustomAssemblies();
        } catch (e) {
            this.main.error.bind(this)("Failed to get custom assemblies:", e);
            return;
        }
        if (this.state == ServerStates.UPDATING) this.setState(oldState);
    }

    /**
     * @returns {Promise<Net.Server>}
     */
    createSocket () {
        return new Promise(function(resolve, reject) {
          let server = new Net.Server();
          server.listen(0, function(s, resolve) {
            resolve(s);
          }.bind(this, server, resolve));
          setTimeout(function (reject) {reject("Socket took too long to open")}.bind(null, reject), 1000);
        }.bind(this));
    }

    async stop (forced) {
        if (this.process == null) return -1; //Server process not active
        if (this.stopInProg != null) return -2;
        this.main.log.bind(this)((forced ? "Force " : "") + "Stopping server " + this.config.label);
    }

    async setState (state) {
        this.state = state;
        this.main.emit("serverStateChange", this);
    }

    async handleExit (code, signal) {
        this.main.log.bind(this)(chalk.red("Server Process Exited with code:"), code, "Signal:", signal);
        this.process = null;
        this.players = null;
        this.uptime = null;
    }

    async handleError (e) {
        this.main.error.bind(this)("Error launching server:", e);
    }

    async handleStdout (data) {
        let d = data.toString().split("\n");
        for (i in d) if (d[i].trim() != "") {
            if (d[i].indexOf("The referenced script") > -1 && d[i].indexOf("on this Behaviour") > -1 && d[i].indexOf("is missing!") > -1) continue;
            if (d[i].indexOf("Filename:  Line: ") > -1) continue;
            if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) continue;
            if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) continue;
            if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) continue;      
            this.main.log.bind(this)(d[i]);
        }
    }

    async handleStderr (data) {
        let d = data.toString().split("\n");
        for (i in d) if (d[i].trim() != "") {
            if (d[i].indexOf("The referenced script") > -1 && d[i].indexOf("on this Behaviour") > -1 && d[i].indexOf("is missing!") > -1) continue;
            if (d[i].indexOf("Filename:  Line: ") > -1) continue;
            if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) continue;
            if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) continue;
            if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) continue;      
            this.main.error.bind(this)(d[i]);
        }
    }

    async start () {
        if (this.process != null) return -1; //Server process already active
        if (this.state == ServerStates.STARTING) return -2; //Server is already starting
        this.main.log.bind(this)("Starting server " + this.config.label);
        this.setState(ServerStates.STARTING);
        this.uptime = new Date().getTime();
        this.players = null;
        try {
            this.socket = await this.createSocket();
            const address = this.socket.address();
            this.consolePort = address.port;
            this.main.log.bind(this)("Console socket created on", this.consolePort);
        } catch (e) {
            this.main.error.bind(this)("Failed to create console socket:", e);
            return -3;
        }
        let executable = fs.existsSync(path.join(this.serverInstallFolder, "SCPSL.exe")) ? path.join(this.serverInstallFolder, "SCPSL.exe") : fs.existsSync(path.join(this.serverInstallFolder, "SCPSL.x86_64")) ? path.join(this.serverInstallFolder, "SCPSL.x86_64") : null;
        if (executable == null) {
            this.main.error.bind(this)("Failed to find executable");
            return -4;
        }
        let cwd = path.parse(executable).dir;
        let base = path.parse(executable).base;
        console.log((process.platform == "win32" ? "" : "./") + base);
        console.log(cwd, "Test: " + "-appdatapath " + path.relative(cwd, this.serverContainer));
        try {
            this.process = spawn((process.platform == "win32" ? "" : "./") + base, ["-batchmode", "-nographics", "-nodedicateddelete", "-port"+this.config.port, "-console"+this.consolePort, "-id"+process.pid, "-appdatapath", path.relative(cwd, this.serverContainer) ,"-vegaId " + this.config.id], {cwd: cwd});
        } catch (e) {
            this.main.error.bind(this)("Failed to start server:", e);
            return -5;
        }
        this.process.stdout.on('data', this.handleStdout.bind(this));
        this.process.stderr.on('data', this.handleStderr.bind(this));
        this.process.on('error', this.handleError.bind(this));
        this.process.on('exit', this.handleExit.bind(this));
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
        if (Array.isArray(basePath)) basePath = joinPaths(basePath);
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
            for (var i in d) {
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
            let tar = require('tar-fs')
            let writer = tar.extract(basePath);
            try {
                let obj = {resolve: function () {}, reject: function () {}};
                setTimeout(function () {
                    writer.write(buffer);
                    writer.end();
                }, 100);
                await new Promise(function (resolve, reject) {this.on("finish", resolve); this.on("error", reject);}.bind(writer));
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

class NVLA extends EventEmitter { 
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

    constructor () {
        super();
    }

    async start () {
        this.config = new settings();
        var serversPath = defaultServersPath;
        if (this.config.overrideServersPath && this.config.overrideServersPath.trim() != "") basePath = overridePath;
        if (Array.isArray(serversPath)) serversPath = joinPaths(serversPath);
        if (!fs.existsSync(serversPath)) fs.mkdirSync(serversPath, {recursive: true});
        this.steam = new steam(this);
        /*
        let check = await this.steam.check();
        if ((this.steam.found != true) || (typeof(check) == "number" && check != 0) || !this.steam.ready) {
            this.log("Steam check failed:", check);
            process.exit();
        }
        */
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

class File {
    /** @type {string} */
    path;

    /** Base64 encoded data 
     * @type {string} */
    data;

    constructor (path, data) {
        this.path = path;
        this.data = data;
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

    /** @type {boolean} */
    connected = false;

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
        this.connected = false;
    }

    async onConnect () {
        this.client.sendMessage(new mt.auth(this.main));
    }

    serverTimeout () {
        this.log.bind(this)("Vega Connection timed out");
        this.client.destroy();
    }

    async onMessage (m, s) {
        try {
            this.messageHandler.handle(m, s);
        } catch (e) {
            this.error.bind(this)("Failed to handle message:", e + "\n", m.type);
        }
    }

    /**
     * @returns {string}
     */
    randomFileRequestId () {
        let id = Math.random().toString(36).slice(2);
        if (this.fileRequests.has(id)) return this.randomFileRequestId();
        return id;
    }

    async onAuthenticated () {
        this.connected = true;
        try {
            //let data = await this.getFile("customAssembly", "Assembly-CSharp");
            //console.log("Got file:", data);
        } catch (e) {
            console.log("Error getting file: " + e);
        }
    }

    /**
     * @param {string} serverId 
     * @returns Promise<Array<File>>
     */
    async getPluginConfiguration (serverId) {
        if (!this.connected) throw "Not connected to Vega";
        this.log.bind(this)("Requesting plugin configuration: "+serverId);
        return new Promise((resolve, reject) => {
            this.client.sendMessage(new mt.pluginConfigurationRequest(this, {resolve: resolve, reject: reject}, serverId));
        });
    }

    /**
     * @param {string} plugin 
     * @returns Promise<File>
     */
    async getPlugin (plugin) {
        if (!this.connected) throw "Not connected to Vega";
        this.log.bind(this)("Requesting plugin: "+plugin);
        return new Promise((resolve, reject) => {
            this.client.sendMessage(new mt.pluginRequest(this, {resolve: resolve, reject: reject}, plugin));
        });
    }

    /**
     * @param {string} plugin 
     * @returns Promise<File>
     */
    async getCustomAssembly (customAssembly) {
        if (!this.connected) throw "Not connected to Vega";
        this.log.bind(this)("Requesting custom assembly: "+customAssembly);
        return new Promise((resolve, reject) => {
            this.client.sendMessage(new mt.customAssemblyRequest(this, {resolve: resolve, reject: reject}, customAssembly));
        });
    }

    /**
     * @param {string} plugin 
     * @returns Promise<File>
     */
    async getDependency (dependency) {
        if (!this.connected) throw "Not connected to Vega";
        this.log.bind(this)("Requesting dependency: "+dependency);
        return new Promise((resolve, reject) => {
            this.client.sendMessage(new mt.dependencyRequest(this, {resolve: resolve, reject: reject}, dependency));
        });
    }

    /**
     * @param {string} serverId 
     * @returns Promise<Array<File>>
     */
    async getDedicatedServerConfiguration (serverId) {
        if (!this.connected) throw "Not connected to Vega";
        this.log.bind(this)("Requesting dedicated server configuration: "+serverId);
        return new Promise((resolve, reject) => {
            this.client.sendMessage(new mt.dedicatedServerConfigurationRequest(this, {resolve: resolve, reject: reject}, serverId));
        });
    }

    async getFile (type, file) {
        if (!this.connected) throw "Not connected to Vega";
        this.log.bind(this)("Requesting "+type+": "+file);
        return new Promise((resolve, reject) => {
            new mt.pluginConfigurationRequest(this, serverId, plugin);
            let id = this.randomFileRequestId();
            this.fileRequests.set(id, {resolve: resolve, reject: reject});
            this.client.sendMessage({type: "fileRequest", id: id, fileType: type, file: file});
        });
    }

    async onClose () {
        this.connected = false;
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
    Server: Server,
    File: File
}