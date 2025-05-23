const StandardIOHandler = require('./standardIOHandler.js');
const ServerMonitor = require('./serverMonitor.js');
const Module = require('./module.js');
const serverState = require('./serverState.js');
const ServerConfig = require('./serverConfig.js');
const ServerPaths = require('./serverPaths.js');
const fs = require('fs');
const path = require('path');
const Steam = require("../steam/steam.js");
const { StateStrings, States } = require("../steam/Util.js");
const util = require("./util.js");
const ServerHooks = require("./serverHooks.js");
const { spawn } = require("child_process");
const serverTimeouts = require('./serverTimeouts.js');
const Downloader = require('./downloader.js');
const ServerOnStateUpdate = require('./messages/templates/serverOnStateUpdate.js');
const SettingChangeHandler = require('./serverSettingChangeHandler.js');
const ServerConsoleLog = require('./messages/templates/serverConsoleLog.js');

//TODO: File watchers that ONLY upload newly created files and ignore files that are defined in a .ignore file
//TODO: We need to make a dedicated thread that will spawn the server process and handle all the IO so that we can spread the load and take it off the main process whenever theres a lot of data being sent by the server through stdio OR the net socket
// I think this thread should only contain the net socket and the stdio handlers, the rest of the server functions should be in the main process

//This is the main process side of the server class
class Server extends Module {
    /** @type {import("child_process")["ChildProcess"]["prototype"]} */
    process;

    watchdog;

    timeout;

    /** @type string */
    lastRestart;

    restartCount = 0;

    configured = false;

    lastModified = 0;

    get id() {
        return this.config.id;
    }

    get label() {
        return this.config.label;
    }

    /**
     * @param {import("./core.js")["Main"]["prototype"]} core 
     */
    constructor(core, config, store = true) {
        super(core);
        this.stop = this.shutdown.bind(this);
        this.config = new ServerConfig(core, config);
        this.settingChangeHandler = new SettingChangeHandler(this);
        this.ioHandler = new StandardIOHandler(this);
        this.paths = new ServerPaths(this);
        this.monitor = new ServerMonitor(this);
        this.state = new serverState(this);
        this.hooks = new ServerHooks(this);
        this.downloader = new Downloader(this);
        this.downloader.on("progress", () => this.state.downloadingCount = this.downloader.count); 
        this.state.on("set", this.onStateUpdate.bind(this));

        if (store) {
            this.main.servers.set(this.id, this);
            this.init();
        }
    }

    //Only ran after the contructor is done
    async init() {
        let result;
        if (!this.installed) result = await this.installApplication();
        if (typeof result == "number") return;
        result = await this.configure();
        if (this.config.autoStart && typeof result != "number") this.start();
    }

    get installed() {
        let windowsPath = path.join(this.paths.serverContainer, "SCPSL.exe");
        let linuxPath = path.join(this.paths.serverContainer, "SCPSL.x86_64");
        if (fs.existsSync(windowsPath) || fs.existsSync(linuxPath)) return true;
        else return false;
    }

    cancelOperation() {
        //requires support for canceling installs and updates
        if (this.state.updating || this.state.installing) {
            if (this.steam != null) this.steam.cancel = true;
            this.steam?.destroy();
        } else if (this.state.configuring) {
            this.downloader.cancelAll();
        }
        if (this.process == null) return -1;
        if (this.state.delayedRestart) {
            this.command("rnr");
            this.hooks.resolve("restart", -9); //User Canceled
        } else if (this.state.delayedStop) {
            this.command("snr");
            this.hooks.resolve("shutdown", -9); //User Canceled
        } else if (this.state.starting) {
            this.state.stopping = true;
            this.state.starting = false;
            this.process.kill();
        }
    }

    async installApplication() {
        if (this.state.installing) return -1; //Server is already installing
        if (this.state.starting) return -2; //Server is already updating
        this.state.installing = true;
        this.log("Installing application", this.main.lp({ consoleColor: 4 }));
        let steam = new Steam(this.main.settings.Steam.toObject());
        this.steam = steam;
        steam.on("login", () => this.log("Logged in to steam"));

        steam.on("disconnect", () => this.log("Disconnected from steam"));

        steam.on("error", e => this.error("Steam Error: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack })));

        steam.on("state", v => {
            this.log("State: " + StateStrings[v])
            this.state.steam = StateStrings[v];
        });

        steam.on("destroy", () => { this.steam = null; this.state.steam = null });

        steam.on("progress", p => {
            let bytes = p.downloaded != null ? p.downloaded : 0;
            let dBytes = p.total != null ? p.total : 0;
            let percent = p.downloaded != null && p.total != null ? Math.floor(p.downloaded / p.total * 10000) / 100 : 0;
            this.log("Progress: {bytes}/{dBytes} {percent}%", this.main.lp({ bytes: bytes, dBytes: dBytes, percent: percent }));
            this.state.percent = p.downloaded != null && p.total != null ? Math.floor(p.downloaded / p.total * 100) : -1;
        });

        await steam.hook(); // Waits for steam to be ready

        if (steam.state != States.Ready) {
            if (steam.cancel) {
                this.state.installing = false;
                this.state.percent = -1;
                this.state.steam = null;
                return -3; //Download was canceled
            }
            this.error("Steam was not ready when hook was triggered, cannot install application");
            this.state.error = "Steam was not ready for download";
            this.state.installing = false;
            this.state.percent = -1;
            this.state.steam = null;
            return -1; //Download was probably canceled
        }
        try {
            let result;
            if (!this.config.beta) result = await steam.download(996560, this.paths.serverContainer);
            else result = await steam.download(996560, this.paths.serverContainer, this.config.beta, this.config.betaPassword).catch(() => -2);
            if (typeof result == "number") throw new Error("Process error " + result);
            this.log("Download complete", this.main.lp({ consoleColor: 2 }));
        } catch (e) {
            if (steam.cancel) {
                this.state.installing = false;
                this.state.percent = -1;
                this.state.steam = null;
                return -3; //Download was canceled
            }
            this.error("Failed to download application: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
            this.state.error = "Failed to download application";
            this.state.installing = false;
            this.state.percent = -1;
            this.state.steam = null;
            steam.destroy();
            return -2;
        }
        this.state.installing = false;
        this.state.percent = -1;
        this.state.steam = null;
        steam.destroy();
    }

    async configure () {
        if (this.state.configuring) return -1; //Server is already configuring
        if (this.state.starting) return -2; //Server is starting
        if (this.state.installing) return -3; //Server is installing
        this.downloader.cancelAll();
        this.state.configuring = true;
        this.log("Configuring server", this.main.lp({ consoleColor: 4 }));
        
        /** @type {Array<import("./file")>} */
        let pluginConfigs = this.main.vega.requestFiles("pluginConfigs", this.id).catch(this.fileRequestError.bind(this));
        
        /** @type {Array<import("./file")>} */
        let serverConfigs = this.main.vega.requestFiles("serverConfigs", this.id).catch(this.fileRequestError.bind(this));
        
        /** @type {Array<import("./file")>} */
        let globalConfigs = this.main.vega.requestFiles("globalConfigs", this.id).catch(this.fileRequestError.bind(this));

        let res = await Promise.all([pluginConfigs, serverConfigs, globalConfigs]);
        pluginConfigs = res[0];
        serverConfigs = res[1];
        globalConfigs = res[2];
        if (pluginConfigs != null && serverConfigs != null && globalConfigs != null && typeof pluginConfigs != "number" && typeof serverConfigs != "number" && typeof globalConfigs != "number") {
            for (let i in pluginConfigs) this.checkFile("pluginConfigs", pluginConfigs[i]);
            for (let i in serverConfigs) this.checkFile("serverConfigs", serverConfigs[i]);
            for (let i in globalConfigs) this.checkFile("globalConfigs", globalConfigs[i]);

            this.state.downloadingCount = this.downloader.count;
            
            let configs = await this.downloader.hook()?.catch(e => {
                this.error(e);
                if (Array.isArray(e) && e.filter(e => e.message == -3).length == 0) return -3; //User canceled
                this.log("Failed to download files: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
                this.state.error = "Failed to download files";
                return -2;
            });
            this.state.downloadingCount = -1;
            if (typeof configs == "number") {
                this.state.configuring = false;
                return configs; //Error downloading files
            }
            
            this.cleanFolder(this.paths.pluginConfigsFolderPath, pluginConfigs);
            this.cleanFolder(this.paths.serverConfigsFolder, serverConfigs);
            this.cleanFolder(this.paths.globalDedicatedServerConfigFiles, globalConfigs);
        } else {
            this.state.configuring = false;
            return -1;
        }

        /** @type {Array<import("./assembly")>} */
        let plugins = this.main.vega.requestAssemblies("plugins", this.config.plugins).catch(this.assemblyRequestError.bind(this));

        /** @type {Array<import("./assembly")>} */
        let dependancies = this.main.vega.requestAssemblies("dependencies", this.config.dependancies).catch(this.assemblyRequestError.bind(this));
        
        /** @type {Array<import("./assembly")>} */
        let customAssemblies = this.main.vega.requestAssemblies("customAssemblies", this.config.customAssemblies).catch(this.assemblyRequestError.bind(this));

        let res2 = await Promise.all([plugins, dependancies, customAssemblies]);
        plugins = res2[0];
        dependancies = res2[1];
        customAssemblies = res2[2];

        if (plugins != null && dependancies != null && customAssemblies != null && typeof plugins != "number" && typeof dependancies != "number" && typeof customAssemblies != "number") {
            for (let i in plugins) this.checkAssembly("plugins", plugins[i]);
            for (let i in dependancies) this.checkAssembly("dependencies", dependancies[i]);
            for (let i in customAssemblies) this.checkAssembly("customAssemblies", customAssemblies[i]);

            this.state.downloadingCount = this.downloader.count;

            let assemblies = await this.downloader.hook()?.catch(e => {
                this.error(e);
                if (Array.isArray(e) && e.filter(e => e.message == -3).length == 0) return -3; //User canceled
                this.log("Failed to download assemblies: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
                this.state.error = "Failed to download assemblies";
                return -2;
            });
            this.state.downloadingCount = -1;
            if (typeof configs == "number") {
                this.state.configuring = false;
                return assemblies; //Error downloading assemblies
            }
            this.cleanAssemblies(this.paths.pluginsFolderPath, plugins);
            this.cleanAssemblies(this.paths.dependanciesFolderPath, dependancies);
        }
        this.configured = true;
        this.state.configuring = false;
    }

    async update() {
        if (this.state.updating) return -1; //Server is already updating
        if (this.state.installing) return -2; //Server is already installing
        if (this.state.configuring) return -3; //Server is already configuring
        if (this.state.starting) return -4; //Server is starting
        this.log("Updating server", this.main.lp({ consoleColor: 4 }));
        var result = await this.installApplication();
        if (typeof result == "number") return result; //Error installing application
        result = await this.configure();
        if (typeof result == "number") return result; //Error configuring server
    }

    fileRequestError (e) {
        this.log("File Request Error: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
        return null;
    }

    assemblyRequestError (e) {
        this.log("Assembly Request Error: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
        return null;
    }

    /**
     * @param {string} label 
     * @param {import("./file.js")} assembly 
     * @returns 
     */
    checkFile (label, file) {
        let folder;
        if (label == "pluginConfigs") folder = this.paths.pluginConfigsFolderPath;
        else if (label == "serverConfigs") folder = this.paths.serverConfigsFolder;
        else if (label == "globalConfigs") folder = this.paths.globalDedicatedServerConfigFiles;
        let fsPath = path.join(folder, util.convertToPath(file.path));

        if (fs.existsSync(fsPath)) {
            let md5;
            try {
                md5 = util.md5(fsPath);
            } catch (e) {
                this.log("Failed to calculate md5: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
                return null;
            }
            if (md5 == file.md5) return;
            //console.log("MD5", md5, file.md5, file);
        }
        this.log("File {file} not found or md5 mismatch, downloading", this.main.lp({ label: label, file: file.path, consoleColor: 4 }));
        this.downloader.downloadFile(label, this.id, file.path, fsPath);
    }

    /**
     * @param {string} label 
     * @param {import("./assembly.js")} assembly 
     * @returns 
     */
    checkAssembly (label, assembly) {
        let folder;
        if (label == "plugins") folder = this.paths.pluginsFolderPath;
        else if (label == "customAssemblies") folder = this.paths.serverCustomAssembliesFolder;
        else if (label == "dependencies") folder = this.paths.dependanciesFolderPath;
        let fsPath = path.join(folder, assembly.name + ".dll");

        if (fs.existsSync(fsPath)) {
            let md5;
            try {
                md5 = util.md5(fsPath);
            } catch (e) {
                this.log("Failed to calculate md5: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
                return null;
            }
            if (md5 == assembly.md5) return;
            //console.log("MD5", md5, assembly.md5, assembly);
        }
        this.log("Assembly {assembly} not found or md5 mismatch, downloading", this.main.lp({ label: label, assembly: assembly.name, consoleColor: 4 }));
        this.downloader.downloadAssembly(label, assembly.name, fsPath);
    }

    fileEvent (event, folderLabel, file) {
        //this.log("File event: {event} {folderLabel} {file}", this.main.lp({ event: event, folderLabel: folderLabel, file: file }));
        if (event == "remove") {
            this.log("File {file} removed from {folderLabel}", this.main.lp({ file: file.path, folderLabel: folderLabel, consoleColor: 4 }));
            let folder;
            if (folderLabel == "pluginConfigs") folder = this.paths.pluginConfigsFolderPath;
            else if (folderLabel == "serverConfigs") folder = this.paths.serverConfigsFolder;
            else if (folderLabel == "globalConfigs") folder = this.paths.globalDedicatedServerConfigFiles;
            let fsPath = path.join(folder, util.convertToPath(file.path));
            if (fs.existsSync(fsPath)) {
                try {
                    fs.rmSync(fsPath, { recursive: true, force: true });
                } catch (e) {
                    this.error("Failed to delete file: {file}\n{e}", this.main.lp({ file: fsPath, e: e }));
                }
            }
        } else {
            this.checkFile(folderLabel, file);
        }
    }

    assemblyEvent (event, label, assembly) {
        //this.log("Assembly event: {event} {label} {assembly}", this.main.lp({ event: event, label: label, assembly: assembly }));
        if (event == "remove") {
            this.log("Assembly {assembly} removed from {label}", this.main.lp({ assembly: assembly.name, label: label, consoleColor: 4 }));
            let folder;
            if (label == "plugins") folder = this.paths.pluginsFolderPath;
            else if (label == "customAssemblies") folder = this.paths.serverCustomAssembliesFolder;
            else if (label == "dependencies") folder = this.paths.dependanciesFolderPath;
            let fsPath = path.join(folder, assembly.name + ".dll");
            if (fs.existsSync(fsPath)) {
                try {
                    fs.rmSync(fsPath, { recursive: true, force: true });
                } catch (e) {
                    this.error("Failed to delete assembly: {assembly}\n{e}", this.main.lp({ assembly: fsPath, e: e }));
                }
            }
        } else {
            this.checkAssembly(label, assembly);
        }
    }

    /**
     * @param {string} folder 
     * @param {Array<import("./file.js")>} expected 
     * @param {Array<string>} track 
     * @returns 
     */
    cleanFolder (folder, expected, track = []) {
        if (!fs.existsSync(folder)) return this.log("Path does not exist: {path}", this.main.lp({ path: folder }));
        const files = fs.readdirSync(folder, { withFileTypes: true });
        for (const file of files) {
            const name = file.name;
            const filePath = path.join(folder, name);
            if (file.isDirectory()) {
                this.cleanFolder(filePath, expected, [...track, name]); // Recursively clean subfolders
            } else {
                track.push(name);
                if (expected.find(f => util.convertToPath(f.path) == util.convertToPath(track)) != null) return;
                this.log("Unexpected item, deleting: {filePath}", this.main.lp({ filePath: filePath }));
                try {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } catch (e) {
                    this.error("Failed to delete: {filePath}\n{e}", this.main.lp({ filePath: filePath, e: e }));
                }
                track.pop(); // Remove the file from the track
            }
        }
    }

    /**
     * @param {string} path 
     * @param {Array<import("./assembly.js")>} expected 
     * @returns 
     */
    cleanAssemblies (folder, expected) {
        if (!fs.existsSync(folder)) return this.log("Path does not exist: {path}", this.main.lp({ path: folder }));
        const files = fs.readdirSync(folder);
        for (const file of files) {
            if (file.endsWith(".dll")) {
                const filePath = path.join(folder, file);
                if (!expected.some(assembly => assembly.name + ".dll" === file)) {
                    this.log("Unexpected assembly found, deleting: {filePath}", this.main.lp({ filePath: filePath }));
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        this.error("Failed to delete assembly: {filePath}\n{e}", this.main.lp({ filePath: filePath, e: e }));
                    }
                }
            }
        }
    }

    async uninstall(force = false) {
        if (this.state.uninstalling) return -1; //Server is already uninstalling
        if (!force) {
            if (this.state.starting) return -2; //Server is starting
            if (this.state.installing) return -3; //Server is installing
            if (this.state.updating) return -4; //Server is updating
            if (this.state.configuring) return -5; //Server is configuring
            if (this.state.stopping) return -6; //Server is stopping
            if (this.state.restarting) return -7; //Server is restarting
        }
        this.state.uninstalling = true;

        this.log("Uninstalling server", this.main.lp({ consoleColor: 4 }));
        if (this.process != null) {
            if (!this.state.stopping) await this.shutdown(true); //Force shutdown the server
            else await this.hooks.promise("shutdown");
        }
        try {
            fs.rmSync(this.paths.serverContainer, { recursive: true, force: true });
        } catch (e) {
            this.error("Failed to remove server container: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
        }
        this.main.servers.delete(this.id);
        this.log("Server uninstalled", this.main.lp({ consoleColor: 2 }));
        this.state.uninstalling = false;
    }

    async shutdown(force = false) {
        if (this.process == null) return -1; //Server process not active
        console.log(this.state.starting, this.state.stopping, this.state.delayedStop)
        if ((this.state.stopping && !this.state.delayedStop) || (this.state.starting)) {
            this.log("Killing server", this.main.lp({ consoleColor: 6 }));
            if (this.state.starting == true) {
                this.state.starting = false;
                this.state.stopping = true;
            }
            this.process.kill(9);
        } else if (this.state.delayedStop || (!this.state.stopping && this.state.players <= 0) || force) {
            this.log("Force Stopping server", this.main.lp({ consoleColor: 6 }));
            this.state.delayedStop = false;
            this.state.stopping = true;
            this.command("stop");
            if (this.timeout != null) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            this.timeout = setTimeout(serverTimeouts.stopTimeout.bind(this), 1000 * this.config.maximumShutdownTime);
        } else if (!this.state.stopping && this.state.players > 0) {
            this.log("Stopping server Delayed", this.main.lp({ consoleColor: 6 }));
            this.command("snr");
        }
        return this.hooks.promise("shutdown");
    }

    async start() {
        if (this.state.starting) return this.hooks.promise("start"); //Server is already starting
        if (this.process != null) return -1; //Server process already active
        if (this.state.installing) return -3; //Server is installing
        if (this.state.updating) return -4; //Server is updating
        if (this.state.configuring) return -5; //Server is configuring
        if (this.state.uninstalling) return -10; //Server is uninstalling
        if (this.main.stopped) return -11; //Prevent starting when NVLA is shutting down

        await this.main.memoryMonitor.checkMemory();
        if (this.main.memoryMonitor.lowMemory) {
            this.state.error = "System memory too low";
            return -11; //Machine memory is too low to start the server
        }
        this.log("Starting server", this.main.lp({ consoleColor: 4 }));

        this.monitor.enabled = true;
        this.fullReset();
        this.state.uptime = new Date().getTime();
        this.state.starting = true;
        this.state.transfering = false;
        this.state.restarting = false;
        this.state.error = null;

        if (!fs.existsSync(path.join(this.paths.serverContainer, "hoster_policy.txt"))) {
            try {
                fs.writeFileSync(path.join(this.paths.serverContainer, "hoster_policy.txt"), "gamedir_for_configs: true");
            } catch (e) {
                this.log("Failed to create hoster policy file: {error}", this.main.lp({ error: e?.code || e?.message || e }));
                return -10; //Failed to create hoster policy file
            }
        } else {
            let data;
            try {
                data = fs.readFileSync(path.join(this.paths.serverContainer, "hoster_policy.txt")).toString();
            } catch (e) {
                this.log("Failed to read hoster policy file: {error}", this.main.lp({ error: e?.code || e?.message || e }));
                return -10; //Failed to read hoster policy file
            }
            if (data != "gamedir_for_configs: true") fs.writeFileSync(path.join(this.paths.serverContainer, "hoster_policy.txt"), "gamedir_for_configs: true");
        }

        let executable = fs.existsSync(path.join(this.paths.serverContainer, "SCPSL.exe")) ? path.join(this.paths.serverContainer, "SCPSL.exe") : fs.existsSync(path.join(this.paths.serverContainer, "SCPSL.x86_64")) ? path.join(this.paths.serverContainer, "SCPSL.x86_64") : null;
        if (executable == null) {
            this.state.error = "Failed to find executable";
            this.error("Failed to find executable");
            this.state.starting = false;
            return -4;
        }
        let consolePort;
        try {
            await this.ioHandler.socket;
            const address = this.ioHandler.socket.address();
            consolePort = address.port;
            this.log("Console socket created on {port}", this.main.lp({ port: consolePort }));
        } catch (e) {
            this.state.error = "Failed to create console socket: " + e;
            this.error("Failed to create console socket: {e}", this.main.lp({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
            return -3;
        }
        let cwd = path.parse(executable).dir;
        let base = path.parse(executable).base;
        if (typeof this.config.port != "number" || this.config.port < 1 || this.config.port > 65535) return -15; //Invalid port number supplied
        try {
            let target = (process.platform == "win32" ? "" : "./") + base;
            let args = ["-batchmode", "-nographics", "-nodedicateddelete", "-port" + this.config.port, "-console" + consolePort, "-id" + process.pid, "-appdatapath", path.relative(cwd, this.paths.serverContainer), "-vegaId " + this.id];
            this.verbose("Starting process: {cwd} {target}", this.main.lp({ cwd: cwd, target: target, args: args }));
            this.process = spawn(target, args, { cwd: cwd });
        } catch (e) {
            this.error("Failed to start server: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
            this.state.error = "Failed to start server: " + e;
            this.ioHandler.destroy();
            return -5;
        }
        this.process.stdout.on("data", this.ioHandler.handleStdout.bind(this.ioHandler));
        this.process.stderr.on("data", this.ioHandler.handleStderr.bind(this.ioHandler));
        this.process.on("error", this.handleError.bind(this));
        this.process.on("exit", this.handleExit.bind(this));

        if (this.timeout != null) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }

        if (this.config.watchForStart || this.state.transfering) this.timeout = setTimeout(serverTimeouts.startTimeout.bind(this), 1000 * this.config.maximumStartupTime);
        return this.hooks.promise("start");
    }

    restart(forced = false) {
        if (this.process == null) return this.start();
        if (this.state.stopping) return -2; //Server stopping
        if (this.state.starting) return -3; //Server restarting
        if (this.state.uninstalling) return -5; //Server uninstalling
        if (this.state.delayedStop) this.command("snr");
        if (this.state.delayedRestart || (!this.state.restarting && this.state.players <= 0) || forced) {
            this.log("Force Restarting server", this.main.lp({ color: 6 }));
            this.state.delayedRestart = false;
            this.state.restarting = true;
            this.command("softrestart");
            if (this.timeout != null) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            this.timeout = setTimeout(serverTimeouts.restart.bind(this), 1000 * this.config.maximumRestartTime);
        } else if (!this.state.restarting && this.state.players > 0 && this.timeout == null) {
            this.log("Restarting server delayed", this.main.lp({ color: 6 }));
            this.command("rnr");
            this.timeout = setTimeout(serverTimeouts.delayedRestart.bind(this), 2000);
        }
        return this.hooks.promise("restart");
    }

    command(command, nolog = false) {
        if (this.process == null || this.ioHandler.connectionToServer == null) return -1;
        command = command.trim();
        if (!nolog) this.log("Sending command: {command}", this.main.lp({ command: command, consoleColor: 2 }));
        try {
            this.ioHandler.connectionToServer.write(Buffer.concat([util.toInt32(command.length), Buffer.from(command)]));
            if (!nolog && this.main.vega.connected) this.main.vega.send(new ServerConsoleLog(this.main.vega, this.id, "> " + command.trim(), 6, Date.now()));
        } catch (e) {
            this.error("Console Socket Write Error: {e}", this.main.lp({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e, color: 4 }));
            return -2;
        }
    }

    onStateUpdate (data) {
        if (data.value == data.old) return;
        this.main.vega.send(new ServerOnStateUpdate(this.main.vega, this.id, data));
    }

    async OnUpdate() {
        if (this.config.dailyRestarts && new Date().getHours() == this.config.restartTime.hour && new Date().getMinutes() == this.config.restartTime.minute) {
            let date = ((new Date().getMonth()) + "-" + (new Date().getDate()));
            if (this.lastRestart != date && this.process != null) {
                let value;
                if (this.state.restarting == false && this.state.delayedRestart == false) {
                    try {
                        value = await this.restart(false);
                    } catch (e) {
                        value = e;
                    }
                }
                if (value != null) {
                    this.lastRestart = date;
                    this.error("Failed to restart server, code:{e}", this.main.lp({ e: value }));
                } else {
                    this.log("Scheduled Restart in progress", this.main.lp({ color: 6 }));
                    this.lastRestart = date;
                }
            }
        }
    }

    async handleExit(code, signal) {
        this.log("Server Process Exited with {code} - {signal}", this.main.lp({ code: code, signal: signal, color: 4 }));
        this.monitor.enabled = false;
        this.fullReset();
        if (this.timeout != null) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        this.hooks.resolve("shutdown");
        this.hooks.resolve("restart");
        if (this.state.transfering && this.main.activeTransfers.has(this.config.id) && this.main.activeTransfers.get(this.config.id).direction == "source") {
            this.log("Server Transfering", this.main.lp({ color: 2 }));
            this.state.transfering = false;
            this.state.stopping = false;
            this.state.restarting = false;
            this.uninstall();
            this.main.activeTransfers.get(this.config.id).state = "Ready";
            this.main.activeTransfers.delete(this.config.id);
            return;
        }
        this.state.transfering = false;
        if (this.state.stopping) {
            this.state.stopping = false;
            this.state.restarting = false;
            if (this.state.starting) this.hooks.resolve("start", -9); //User Canceled
            this.state.starting = false;
            return;
        }
        if (this.state.restarting) {
            if (this.main.stopped) return; //Prevent starting when NVLA is shutting down
            this.log("Server Restarting", this.main.lp({ color: 2 }));
            this.state.restarting = false;
            this.state.starting = false;
            this.start().catch(() => { });
            return;
        }
        if (this.state.starting) {
            this.error("Server Startup failed, Exited with {code} - {signal}", this.main.lp({ code: code, signal: signal }));
            if (this.state.error == null) this.state.error = "Server exited during startup, Exited with " + code + " - " + signal;
            this.state.starting = false;
            if (this.restartCount < 3) {
                this.restartCount++;
                setTimeout(function () { this.start().catch(() => { }); }.bind(this), 500);
                return;
            }
            this.restartCount = 0;
            this.state.error = "Server does not complete startup";
            this.hooks.resolve("start", -4);
            return;
        }
        this.error("Unexpected server death, Exited with {code} - {signal}", this.main.lp({ code: code, signal: signal }));
        this.start().catch(() => { });
    }

    async handleError(e) {
        this.error("Error launching server: {e}", this.main.lp({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
        this.state.error = "Error launching server";
        this.hooks.resolve("start", -5);
    }

    fullReset() {
        this.ioHandler.destroy();
        this.process = null;
        this.state.players = null;
        this.state.tps = null;
        this.state.uptime = null;
        this.monitor.nvlaMonitorInstalled = false;
        this.state.running = false;
        this.state.delayedRestart = false;
        this.state.delayedStop = false;
        this.state.updatePending = false;
        this.state.idleMode = false;
        this.state.memory = null;
        this.state.cpu = null;
        this.monitor.checkInProgress = false;
        clearTimeout(this.monitor.checkTimeout);
        this.monitor.checkCallback = null;
        this.monitor.checkTimeout = null;
        this.monitor.checkTimeoutCount = 0;
    }

    clearLALogs () {
        this.log("Clearing ServerLogs");
        let target = path.join(this.paths.appdata, "ServerLogs");
        if (!fs.existsSync(target)) return;
        try {
          fs.rmSync(target, {recursive: true, force: true});
        } catch (e) {
          this.error("Failed to clear ServerLogs\n{e}", {e: e});
        }
        target = path.join(this.paths.appdata, "Metrics");
        if (!fs.existsSync(target)) return;
        try {
          fs.rmSync(target, {recursive: true, force: true});
        } catch (e) {
          this.error("Failed to clear Metrics\n{e}", {e: e});
        }
    }

    toJSON() {
        return {};
    }
}

module.exports = Server;