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

    get id() {
        return this.config.id;
    }

    get label() {
        return this.config.label;
    }

    /**
     * @param {import("./core.js")["Main"]["prototype"]} core 
     */
    constructor(core, config) {
        super(core);
        this.config = new ServerConfig(core, config);
        this.ioHandler = new StandardIOHandler(this);
        //TODO: Use this.config event emitter
        this.paths = new ServerPaths(this);
        this.monitor = new ServerMonitor(this);
        this.state = new serverState(this);
        this.hooks = new ServerHooks(this);
        //TODO: Use this.state event emitter

        this.main.servers.set(this.id, this);
        this.init();
    }

    //Only ran after the contructor is done
    async init() {
        if (!this.installed) await this.installApplication();
        let result = await this.configure();

        return;
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
            this.steam.destroy();
        } else if (this.state.configuring) {
            //TODO
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
        this.state.installing = true;
        let steam = new Steam(this.main.settings.Steam.toObject());
        this.steam = steam;
        steam.on("login", () => this.log("Logged in to steam"));

        steam.on("disconnect", () => this.log("Disconnected from steam"));

        steam.on("error", e => this.error("Steam Error: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack })));

        steam.on("state", v => {
            this.log("State: " + StateStrings[v])
            this.state.steam = StateStrings[v];
        });

        steam.on("destroy", () => { this.steam = null });

        steam.on("progress", p => {
            let bytes = p.downloaded != null ? p.downloaded : 0;
            let dBytes = p.total != null ? p.total : 0;
            let percent = p.downloaded != null && p.total != null ? Math.floor(p.downloaded / p.total * 10000) / 100 : 0;
            this.log("Progress: {bytes}/{dBytes} {percent}%", this.main.lp({ bytes: bytes, dBytes: dBytes, percent: percent }));
            this.state.percent = p.downloaded != null && p.total != null ? Math.floor(p.downloaded / p.total * 100) : -1;
        });

        await steam.hook(); // Waits for steam to be ready

        if (steam.state != States.Ready) {
            this.error("Steam was not ready when hook was triggered, cannot install application");
            this.state.installing = false;
            this.state.percent = -1;
            this.state.steam = null;
            return -1; //Download was probably canceled
        }
        try {
            if (!this.config.beta) await steam.download(996560, this.paths.serverContainer);
            else await steam.download(996560, this.paths.serverContainer, this.config.beta, this.config.betaPassword);
            this.log("Download complete", this.main.lp({ consoleColor: 2 }));
        } catch (e) {
            this.error("Failed to download application: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
        }
        this.state.installing = false;
        this.state.percent = -1;
        this.state.steam = null;
        steam.destroy();
    }

    fileRequestError (e) {
        this.log("File Request Error: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
        return null;
    }

    async configure (){
        
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
        if (pluginConfigs != null && serverConfigs != null && globalConfigs != null) {
            
            console.log(pluginConfigs[0], serverConfigs[0], globalConfigs);
        } else return -1;
    }

    async uninstall() {
        this.log("Uninstalling server", this.main.lp({ consoleColor: 4 }));
        if (this.process != null) {
            if (!this.state.stopping) await this.shutdown(true); //Force shutdown the server
            await this.hooks.promise("shutdown")
        }
        try {
            fs.rmSync(this.paths.serverContainer, { recursive: true, force: true });
        } catch (e) {
            this.error("Failed to remove server container: {error}", this.main.lp({ error: e?.code || e?.message, stack: e?.stack }));
        }
        this.main.servers.delete(this.id);
        this.log("Server uninstalled", this.main.lp({ consoleColor: 2 }));
    }

    async shutdown(force = false) {
        if (this.process == null) return -1; //Server process not active
        if ((this.state.stopping && !this.state.delayedStop) || (this.state.starting)) {
            this.log("Killing server {label}", this.main.lp({ label: this.config.label, consoleColor: 6 }));
            if (this.state.starting == true) {
                this.state.starting = false;
                this.state.stopping = true;
            }
            this.process.kill(9);
        } else if (this.state.delayedStop || (!this.state.stopping && this.state.players != null && this.state.players.length <= 0) || force) {
            this.log("Force Stopping server {label}", this.main.lp({ label: this.config.label, consoleColor: 6 }));
            this.state.delayedStop = false;
            this.state.stopping = true;
            this.command("stop");
            if (this.timeout != null) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            this.timeout = setTimeout(this.stopTimeout.bind(this), 1000 * this.config.maximumShutdownTime);
        } else if (!this.state.stopping && this.state.players != null && this.state.players.length > 0) {
            this.log("Stopping server {label} Delayed", this.main.lp({ label: this.config.label, consoleColor: 6 }));
            this.command("snr");
        }
        return this.hooks.promise("shutdown");
    }

    async start() {
        if (this.process != null) return -1; //Server process already active
        if (this.state.starting) return -2; //Server is already starting
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
        this.log("Starting server {label}", this.main.lp({ label: this.config.label }));

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

        this.timeout = setTimeout(serverTimeouts.startTimeout.bind(this), 1000 * this.config.maximumStartupTime);
        return this.hooks.promise("start");
    }

    restart(forced = false) {
        if (this.process == null) return this.start();
        if (this.state.stopping) return -2; //Server stopping
        if (this.state.starting) return -3; //Server restarting
        if (this.state.uninstalling) return -5; //Server uninstalling
        if (this.state.delayedStop) this.command("snr");
        if (this.state.delayedRestart || (!this.state.restarting && this.state.players != null && this.state.players.length <= 0) || forced) {
            this.log("Force Restarting server {label}", this.main.lp({ label: this.config.label, color: 6 }));
            this.state.delayedRestart = false;
            this.state.restarting = true;
            this.command("softrestart");
            if (this.timeout != null) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            this.timeout = setTimeout(serverTimeouts.restart.bind(this), 1000 * this.config.maximumRestartTime);
        } else if (!this.state.restarting && this.state.players != null && this.state.players.length > 0 && this.timeout == null) {
            this.log("Restarting server {label} delayed", this.main.lp({ label: this.config.label, color: 6 }));
            this.command("rnr");
            this.timeout = setTimeout(serverTimeouts.delayedRestart.bind(this), 2000);
        }
        return this.hooks.promise("restart");
    }

    command(command, nolog = false) {
        if (this.process == null || this.ioHandler.connectionToServer == null) return -1;
        command = command.trim();
        if (!nolog) this.log("Sending command: {command}", this.main.lp({ command: command, consoleColor: 2 }), nolog);
        try {
            this.ioHandler.connectionToServer.write(Buffer.concat([util.toInt32(command.length), Buffer.from(command)]));
        } catch (e) {
            this.error("Console Socket Write Error: {e}", this.main.lp({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e, color: 4 }));
            return -2;
        }
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
        this.serverMonitor.enabled = false;
        this.fullReset();
        if (this.timeout != null) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        if (this.state.transfering && this.main.activeTransfers.has(this.config.id) && this.main.activeTransfers.get(this.config.id).direction == "source") {
            this.log("Server Transfering", this.main.lp({ color: 2 }));
            this.state.transfering = false;
            //TODO: this.main.vega.client.sendMessage(new mt.sourceReady(this.config.id));
            this.uninstall();
            this.main.activeTransfers.delete(this.config.id);
            return;
        }
        this.state.transfering = false;
        if (this.state.stopping) {
            this.state.stopping = false;
            this.state.restarting = false;
            if (this.state.starting) this.hooks.resolve("start", -9); //User Canceled
            this.state.starting = false;
            this.hooks.resolve("stop");
            return;
        }
        if (this.state.restarting) {
            if (this.main.stopped) return; //Prevent starting when NVLA is shutting down
            this.log("Server Restarting", this.main.lp({ color: 2 }));
            this.state.restarting = false;
            this.state.starting = false;
            this.hooks.resolve("restart");
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
            this.hooks.reject("start", "Startup failure: " + code + " - " + signal);
            return;
        }
        this.error("Unexpected server death, Exited with {code} - {signal}", this.main.lp({ code: code, signal: signal }));
        this.start().catch(() => { });
    }

    async handleError(e) {
        this.error("Error launching server: {e}", this.main.lp({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
        this.hooks.reject("start", "Startup error: " + e.code);
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
    }

    toJSON() {
        return {};
    }
}

module.exports = Server;