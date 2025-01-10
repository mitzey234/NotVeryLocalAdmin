const Settings = require('./settings.js');
const Logging = require('./logging.js');
const Util = require('./util.js');
const pack = require("../package.json");
//TODO: Import server class
const EventEmitter = require("events");
const chalk = require("chalk");
const Vega = require("./vega.js");
var os = require('os-utils');
const { spawn } = require('child_process');

class MachineState extends EventEmitter {
    uptime = Date.now();
  
    cpu = 0;

    systemCPU = 0;
    
    label = "";
  
    constructor() {
        super();
        Util.processObjectShallow(this);
    }
  
    toObject () {
        return Util.filterSerializableProperties(this);
    }
}

/** @augments {Map<string, Server>} */
class ExternalServerMap extends Map {
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
        //TODO: Send to vega
    }
  
    /**
     * @param {string} serverId 
     */
    delete (serverId) {
        if (!this.has(serverId)) return;
        let server = this.get(serverId);
        server.stop();
        super.delete(serverId);
        //TODO: Send to vega
    }
  
    clear () {
        this.forEach((server, id) => this.delete(id));
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

    updateInt = setInterval(() => this.update(), 1000);

    state = new MachineState();

    daemonMode = false;

    servers = new ExternalServerMap(this);

    constructor(daemonMode = false) {
        this.state.label = this.settings.Vega.label;
        this.daemonMode = daemonMode;
        this.state.on("set", this.onStateUpdate.bind(this));
        this.log("Welcome to " + chalk.cyan("NotVeryLocalAdmin") + ' v{version} - {pid}' + (this.daemonMode ? " - Daemon Mode Enabled" : ""), this.lp({consoleColor: 2, pid: process.pid, version: pack.version}));
        this.start();
    }
    
    async start() {
        this.vega = new Vega(this);
        //TODO: check cpu affinity ability
    }
    
    async stop () {
        //TODO: This needs to stop all servers and wait for them to exit
        //TODO: This needs to force quit if called again
        clearInterval(this.recoveryInt);
        this.vega.stop();
        this.SettingChangeHandler.disabled = true;
        this.servers.forEach(server => server.stop());
        while ([...this.servers.values()].filter(server => server.state.state != server.states.stopped).length > 0) await Util.Delay(1);
        this.logger.stop();
        process.exit(0);
    }

    getServer (hint) {
        if (this.servers.has(hint)) {
            return this.servers.get(hint);
        } else {
            let server;
            this.servers.forEach((s) => {
                if (s.config.label == hint || s.config.label.indexOf(hint) > -1) server = s;
            });
            if (server != null) return server;
            this.servers.forEach((s) => {
                if (s.config.port == hint) server = s;
            });
            if (server != null) return server;
        }
    }

    async restart () {
        //TODO: This needs to stop all servers and wait for them to exit
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
        //TODO: Send to vega
    }

    previousTime = Date.now();
    previousUsage = process.cpuUsage();
    lastUsage;

    update () {
        this.updateCPU();
        this.updateSystemCPU();
    }

    updateSystemCPU() {
        os.cpuUsage((v) => {
            this.state.systemCPU = Math.floor(v*10000)/100;
        });
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