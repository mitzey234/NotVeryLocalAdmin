const Settings = require('./settings.js');
const Logging = require('./logging.js');
const Util = require('./util.js');
const pack = require("../package.json");
const Server = require('./server.js');
const chalk = require("chalk");
const Vega = require("./vega.js");
var os = require('os-utils');
const { spawn } = require('child_process');
const MachineState = require('./machineState.js');
const Rebalancer = require('./rebalancer.js');
const pidusage = require('pidusage')
const fs = require('fs');
const path = require('path');
const VerkeyWatcher = require('./verkeyWatcher.js');
const EchoServer = require('./echoServer.js');
const MemoryMonitor = require('./memoryMonitor.js');
const MachineOnStateUpdate = require('./messages/templates/machineOnStateUpdate.js');
const osAlt = require('os');

var verkeyPath = process.platform == "win32" ? path.join(process.env.APPDATA, "SCP Secret Laboratory", "verkey.txt") : path.join(process.env.HOME, ".config", "SCP Secret Laboratory", "verkey.txt");

/** @augments {Map<string, Server>} */
class ServerMap extends Map {
    /** @type {exports.Main} */
    main;
  
    /**
     * @param {exports.Main} main */
    constructor(main) {
        super();
        this.main = main;
    }
  
    /**
     * @param {string} serverId 
     * @param {Server} server 
     */
    set (serverId, server) {
        super.set(serverId, server);
    }
  
    /**
     * @param {string} serverId 
     */
    delete (serverId) {
        if (!super.has(serverId)) return;
        let server = this.get(serverId);
        super.delete(serverId);
        if (!server.state.uninstalling) server.uninstall();
    }
  
    clear () {
        this.forEach((server, id) => this.delete(id));
    }

    toJSON () {
        let obj = {};
        this.forEach((server, id) => obj[id] = server.toJSON());
        return obj;
    }
}

/** @augments {Map<string, import("./serverTransfer.js")>} */
class TranferMap extends Map {

    constructor () {
        super();
    }
}

module.exports.Main = class Main {
    settings = new Settings.Settings();
    SettingChangeHandler = new Settings.SettingChangeHandler(this);
    logger = new Logging.Logger(this);

    log = this.logger.log.bind(this.logger);
    error = this.logger.error.bind(this.logger);
    warn = this.logger.warn.bind(this.logger);
    debug = this.logger.debug.bind(this.logger);

    activeTransfers = new TranferMap();

    stopping = false;

    get verkey () {
        if (fs.existsSync(verkeyPath)) {
            try {
                return fs.readFileSync(verkeyPath).toString();
            } catch (e) {
                this.error("Failed to read verkey: {error}", this.lp({error: e?.code || e?.message, stack: e?.stack}));
            }
        }
        return null;
    }

    set verkey (value) {
        try {
            if (!fs.existsSync(path.parse(verkeyPath).dir)) fs.mkdirSync(path.parse(verkeyPath).dir, { recursive: true });
            fs.writeFileSync(verkeyPath, value);
          } catch (e) {
            this.error("Failed to write verkey: {error}", this.lp({error: e?.code || e?.message, stack: e?.stack}));
          }
    }

    get addresses () {
        const nets = osAlt.networkInterfaces();
        var addresses = [];
        for (let i in nets) {
            let intf = nets[i];
            for (let x in intf) {
                let net = intf[x];
                const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
                if (net.family === familyV4Value && !net.internal && !addresses.includes(net.address)) addresses.push(net.address);
            }
        }
        return addresses;
    }

    constructor(daemonMode = false) {
        this.daemonMode = daemonMode;
        if (!fs.existsSync(this.settings.serversFolder)) fs.mkdirSync(this.settings.serversFolder, { recursive: true });
        this.start();
    }
    
    async start() {
        while (this.logger.ready == false) await Util.Delay(1);
        this.EchoServer = new EchoServer(this);
        this.verkeyWatcher = new VerkeyWatcher(this);
        this.interval = setInterval(this.update.bind(this), 1000);
        this.balancer = new Rebalancer(this);
        this.state = new MachineState();
        this.servers = new ServerMap(this);
        this.memoryMonitor = new MemoryMonitor(this);
        this.state.label = this.settings.Vega.label;
        this.state.on("set", this.onStateUpdate.bind(this));
        this.log("Welcome to " + chalk.cyan("NotVeryLocalAdmin") + ' v{version} - {pid}' + (this.daemonMode ? " - Daemon Mode Enabled" : ""), this.lp({consoleColor: 2, pid: process.pid, version: pack.version}));
        this.update();
        this.vega = new Vega(this);
    }
    
    async stop (preserve = false) {
        if (this.stopping && !preserve) return process.exit(0);
        clearInterval(this.interval);
        this.vega.stop();
        this.stopping = true;
        this.SettingChangeHandler.disabled = true;
        this.servers.forEach(server => server.shutdown(true));
        while ([...this.servers.values()].filter(server => server.process != null).length > 0) await Util.Delay(1);
        this.logger.stop();
        if (!preserve) process.exit(0);
    }

    getServer (hint) {
        if (this.servers.has(hint)) {
            return this.servers.get(hint);
        } else {
            let server;
            this.servers.forEach((s) => {
                if (s.label == hint || s.label.indexOf(hint) > -1) server = s;
            });
            if (server != null) return server;
            this.servers.forEach((s) => {
                if (s.config.port == hint) server = s;
            });
            if (server != null) return server;
        }
    }

    async restart () {
        await this.stop(true);
        if (this.daemonMode) {
            process.exit(6);
        } else {
            const child = spawn('node', ['index.js'], {
                detached: true,
                stdio: 'ignore' 
            });
            child.unref();
            process.exit(0);
        }
    }

    lp(...args) {
        return new Logging.LP(...args);
    }

    onStateUpdate (data) {
        if (data.value === data.old) return;
        this.vega?.send(new MachineOnStateUpdate(this.vega, data));
    }

    previousTime = Date.now();
    previousUsage = process.cpuUsage();
    lastUsage;

    update () {
        this.updateCPU();
        this.updateSystemCPU();
        this.updateServerCPUs();
    }

    updateInProgress = false;

    handlePIDQuery (e, stats) {
        if (e) return this.error("Failed to get server process usage: {error}", this.lp({ error: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
        for (let i in stats) {
            let stat = stats[i];
            if (stat == null) continue;
            /** @type Server */
            let server;
            this.servers.forEach((s) => {
                if (s.process == null || s.process.pid == null) return;
                if (s.process.pid == i) return server = s;
            });
            if (server == null) continue;
            server.state.cpu = stat.cpu / (100 * os.cpuCount());
            server.state.memory = stat.memory;
        }
    }

    updateServerCPUs() {
        if (this.updateInProgress) return;
        this.updateInProgress = true;
        try {
            let pids = [];
            this.servers.forEach((server) => (server.process != null && server.process.pid != null) ? pids.push(server.process.pid) : null);
            if (pids.length > 0) pidusage(pids, this.handlePIDQuery.bind(this));
            this.servers.forEach(async (server) => server.OnUpdate());
        } catch (e) {
            this.error("Failed to update server cpus: {e}", this.lp({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
        }
        this.updateInProgress = false;
    }

    updateSystemCPU() {
        os.cpuUsage((v) => this.state.systemCPU = Math.round(v*100));
    }

    updateCPU() {
        const currentUsage = process.cpuUsage(this.previousUsage);
        this.previousUsage = process.cpuUsage();
        const currentTime = new Date().getTime();
        const timeDelta = (currentTime - this.previousTime) * 10;
        const { user, system } = currentUsage;
        this.lastUsage = { system: system / timeDelta, total: (system + user) / timeDelta, user: user / timeDelta };
        this.previousTime = currentTime;
        this.state.cpu = Math.floor(this.lastUsage.total*100)/100;
    }
}