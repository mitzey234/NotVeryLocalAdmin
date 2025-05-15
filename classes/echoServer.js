const udp = require('dgram');
const { fork } = require('child_process');
const EventEmitter = require('events');
const EchoPort = require('./messages/templates/echoPort');


class EchoServerInternal {
    /** @type udp.Socket */
    server;

    _currentPort;

    get currentPort() {
        return this._currentPort;
    }

    set currentPort(value) {
        this._currentPort = value;
        process.send({ type: "port", value: value });
    }

    _currentAddress;

    get currentAddress() {
        return this._currentAddress;
    }

    set currentAddress(value) {
        this._currentAddress = value;
        process.send({ type: "address", value: value });
    }

    constructor(m) {
        this.main = m;
    }

    onMessage(m) {
        if (m.type == "start") this.start(m.port, m.address);
        else if (m.type == "rebind") this.rebind(m.port, m.address);
    }

    destroy() {
        try {
            this.server.close();
        } catch {
            //Ignore
        }
    }

    rebind(port, address) {
        console.log("Rebound Echo Server");
        this.destroy();
        this.start(port, address);
    }

    start(port, address) {
        if (port == null && this.currentPort != null) port = this.currentPort;
        this.server = udp.createSocket('udp4');
        this.server.on('error', this.echoServerError.bind(this));
        this.server.on('message', this.echoServerMessage.bind(this));
        this.server.on('listening', () => {
            console.log("Listening on", address + ":" + port);
            this.currentPort = port;
            this.currentAddress = address;
        });
        this.server.bind(port, address);
    }

    /**
     * @param {Buffer} msg 
     * @param {udp.RemoteInfo} rinfo 
    */
    echoServerMessage(msg, rinfo) {
        try {
            let m = msg.slice(0, 4);
            this.server.send(m, rinfo.port, rinfo.address);
        } catch (e) {
            console.error("Echo response error: ", e.code, e.message);
        }
    }

    //TODO: Test this
    echoServerError(e) {
        console.error("Bind Error: ", e.code, e.message);
        if (this.currentPort != null && this.currentAddress != null) {
            console.log("Rebinding Echo Server to last working config");
            let port = this.currentPort;
            let address = this.currentAddress;
            this.currentPort = null;
            this.currentAddress = null;
            this.rebind(port, address);
        }
    }
}

class EchoServer extends EventEmitter {
    /** @type import("./core")["Main"]["prototype"] */
    main;

    /** @type import("child_process")["ChildProcess"]["prototype"] */
    process;

    stopping = false;

    _currentPort;

    get currentPort() {
        return this._currentPort;
    }

    set currentPort(value) {
        this._currentPort = value;
        if (this.main.vega.connected) this.main.vega.send(new EchoPort(this.main.vega, value));
    }

    currentAddress;

    constructor(m) {
        super();
        this.main = m;
        if (this.main.settings.echoServerEnabled) this.start();
    }

    //TODO: Test this
    start() {
        if (this.process != null) return;
        this.stopping = false;
        this.process = fork(__filename, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
        this.process.stdout.on("data", this.onData.bind(this));
        this.process.stderr.on("data", this.onData.bind(this, true));
        this.process.on('exit', this.onExit.bind(this));
        this.process.on('error', this.onError.bind(this));
        this.process.on("message", this.onMessage.bind(this));
        this.process.send({ type: "start", port: this.main.settings.echoServerPort, address: this.main.settings.echoServerAddress });
    }

    onData(...data) {
        if (data[0] === true) {
            this.main.error(data[1].toString().trim());
        } else {
            this.main.log(data[0].toString().trim());
        }
    }

    //TODO: Test this
    stop() {
        if (this.process == null) return;
        this.stopping = true;
        this.process.kill();
    }

    //TODO: Test this
    rebind() {
        if (this.process == null) return;
        this.process.send({ type: "rebind", port: this.main.settings.echoServerPort, address: this.main.settings.echoServerAddress });
    }

    onMessage(m) {
        if (m.type == "port") this.currentPort = m.value;
        else if (m.type == "address") this.currentAddress = m.value;
    }

    onExit(code) {
        this.currentAddress = null;
        this.currentPort = null;
        this.process = null;
        this.main.debug("Echo server exited with code {code}", { code: code });
        if (!this.stopping) this.main.restart();
    }

    onError(e) {
        this.main.error("Echo server error: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
}

let main;

if (require.main === module) {
    process.on('SIGINT', () => { }); //Prevent the process from closing
    process.on('SIGTERM', () => { }); //Prevent the process from closing
    main = new EchoServerInternal();
    process.on("message", main.onMessage.bind(main));
}

module.exports = EchoServer;