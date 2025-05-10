const fs = require('fs');
const path = require('path');
const message = require('./message.js');
const { Client } = require("./socket");
const auth = require("./messages/templates/auth");
const RequestFiles = require("./messages/templates/requestFiles");
const RequestAssemblies = require("./messages/templates/requestAssemblies");
const pack = require("../package.json");

class pingSystem {
    pingInProgress = false;
    pingFunction;
    onDead;
    timeout;
    timeouts = 0;
    interval;

    resolve () {
        this.pingInProgress = false;
        clearTimeout(this.timeout);
        this.timeout = null;
        this.timeouts = 0;
    }

    timeoutFunction () {
        this.pingInProgress = false;
        this.timeouts++;
        if (this.timeouts >= 4) {
            this.onDead();
            clearInterval(this.interval);
        }
    }

    ping () {
        if (this.pingInProgress) return;
        this.pingInProgress = true;
        this.pingFunction();
        this.timeout = setTimeout(this.timeoutFunction.bind(this), 5000);
    }

    stop () {
        clearInterval(this.interval);
        clearTimeout(this.timeout);
    }

    constructor (pingFunction, onDead) {
        this.pingFunction = pingFunction;
        this.onDead = onDead;
        this.interval = setInterval(this.ping.bind(this), 1000);
    }
}

class Vega {
    /** @type {import("./core.js")["Main"]["prototype"]} */
    main;

    /** @type Map<string, message> */
    handlers = new Map();

    /** @type Client */
    socket;

    stopping = false;

    connected = false;

    /** @type pingSystem */
    pingSystem;

    requests = new Map();

    /** @type string */
    apiKey = null;

    /** @type number */
    port = null;

    constructor(main) {
        this.main = main;
        fs.readdir(path.join(__dirname, "messages/recieved/"), (err, files) => (err == null ? files.forEach(file => this.addMessage(path.join(__dirname, "messages/recieved", file))) : this.main.error("Message parser config error: {error}", this.main.lp({error: err?.code || err?.message, stack: err?.stack}))) || this.connect());
    }

    async addMessage(file) {
        let def = require(file);
        if (def.prototype == null || !(def.prototype instanceof message)) return this.main.error("Invalid message handler: {file}", this.main.lp({file}));
        this.handlers.set(def.name, def);
        this.main.debug("Added message handler: {name}", this.main.lp({name: def.name}));
    }

    get requestId () {
        let id = 0;
        while (this.requests.has(id)) id++;
        return id;
    }

    connect() {
        if (this.connected) return;
        this.stopping = false;
        this.main.log("Connecting to Vega", this.main.lp({consoleColor: 5}));
        this.error = null;
        this.socket = new Client();
        this.socket.connect({ port: this.main.settings.Vega.port, host: this.main.settings.Vega.host });
        this.socket.on('message', this.onMessage.bind(this));
        this.socket.on('error', this.onError.bind(this));
        this.socket.on('close', this.onClose.bind(this));
        this.socket.on('connect', this.onConnect.bind(this));
        this.pingSystem = new pingSystem(this.socket.send.bind(this.socket, {type: "ping"}), this.socket.destroy.bind(this.socket));
    }

    onMessage(message) {
        let constuctor = this.handlers.get(message.type);
        if (constuctor != null) {
            if (this.main.settings.Vega.debug) this.main.debug("Handling message: {type}", this.main.lp({type: message.type}));
            try {
                /** @type message */
                let handler = new constuctor(this, message);
                handler.handle();
            } catch (e) {
                this.main.error("Error handling message: {error}", this.main.lp({type: message.type, error: e?.code || e?.message, stack: e?.stack}));
            }
        } else {
            this.main.warn("Unknown message type: {type}", this.main.lp({type: message.type}));
        }
    }

    onError (e) {
        this.main.error("Vega connection error: {error}", this.main.lp({error: e?.code || e?.message, stack: e?.stack}));
        this.error = e;
    }

    onClose () {
        this.connected = false;
        this.port = null;
        this.apiKey = null;
        try {
            this.main.servers.forEach(s => s.downloader.cancelAll());
        } catch {}
        if (this.error == null) this.main.log("Vega connection lost", this.main.lp({consoleColor: 4}));
        this.pingSystem.stop();
        if (!this.stopping) setTimeout(this.connect.bind(this), 5000);
    }

    onConnect () {
        this.connected = true;
        this.main.log("Authenticating with Vega", this.main.lp({consoleColor: 9}));
        this.send(new auth(this));
    }

    send (m) {
        if (this.connected) {
            if (m instanceof message) m = m.toObject();
            this.socket.send(m);
        }
    }

    stop () {
        this.stopping = true;
        if (this.pingSystem != null) this.pingSystem.stop();
        if (this.connected) this.socket.destroy();
    }

    promise (obj) {
        let prom = new Promise((resolve, reject) => {
            obj.resolve = resolve;
            obj.reject = reject;
            obj.timeout = setTimeout(() => {
                obj.reject(new Error("Request timed out"));
                this.requests.delete(obj.id);
            }, 10000);
        });
        return prom;
    }

    requestFiles (label, serverId) {
        if (this.connected) {
            this.main.log("Requesting files from Vega: {fileLabel}", this.main.lp({consoleColor: 5, server: serverId, fileLabel: label})); 
            let id = this.requestId;
            let prom = {id};
            this.requests.set(id, prom);
            this.send(new RequestFiles(this, serverId, label, id));
            return this.promise(prom);
        } else {
            this.main.error("Failed to request files from Vega, not connected", this.main.lp({consoleColor: 4}));
            return -1;
        }
    }

    requestAssemblies (label, assemblies) {
        if (this.connected) {
            this.main.log("Requesting assemblies from Vega: {fileLabel}", this.main.lp({consoleColor: 5, fileLabel: label})); 
            let id = this.requestId;
            let prom = {id};
            this.requests.set(id, prom);
            this.send(new RequestAssemblies(this, label, assemblies, id));
            return this.promise(prom);
        } else {
            this.main.error("Failed to request assemblies from Vega, not connected", this.main.lp({consoleColor: 4}));
            return -1;
        }
    }
}

module.exports = Vega;