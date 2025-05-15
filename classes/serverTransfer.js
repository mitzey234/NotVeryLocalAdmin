const Server = require("./server");

class serverTransfer {
    /** @type string */
    transferId;

    /** @type import("./serverConfig") */
    config;

    /** @type import("./server") */
    server;

    /** @type import("./core")["Main"]["prototype"] */
    main;

    /** 'target' or 'source'
     * @type string */
    direction;

    /** @type string */
    _state;

    get state() {
        return this._state;
    }

    set state(v) {
        if (v == this._state) return;
        this._state = v;
        if (this.main.vega.connected) this.main.vega.client.sendMessage(new mt.transferStateUpdate({ key: "transferState", value: v, server: this.server }));
    }

    /**
     * Process:
     * Target and current machine informed
     * Target machine installs server and starts it
     * Target machine spins down server after verifying sucessful start
     * Target informs vega server is ready
     * Vega informs current machine to send restart command to server
     * When current machine server restarts, it cancels the restart and informs vega the server is stopped
     * Vega will then tell the current machine to delete that server and tell the target machine to spin up the server, vega will also update the servers assigned machine ID
     * When target machine gets spinup request it will register the server in its servers map and start the server
     * @param {import("./serverConfig")} config
     * @param {import("./core"} main 
     */
    constructor(config, main, direction) {
        this.main = main;
        this.main.log("Starting transfer of server {server} {direction}", this.main.lp({ server: config.label, direction: direction, consoleColor: 5 }));
        this.transferId = config.id;
        this.config = config;
        this.direction = direction;
        if (direction == "target" && this.main.servers.has(config.id)) {
            this.cancel("Server already exists");
            return -1;
        }
        if (this.main.activeTransfers.has(this.transferId)) {
            this.cancel("Transfer already in progress");
            return -1;
        }
        if (direction == "target") this.server = new Server(main, config, false);
        else this.server = this.main.servers.get(config.id);
        if (this.server == null) {
            this.cancel("Server not found");
            return -1;
        }
        if (direction == "target") this.install();
        else if (this.server.process != null) this.readySource();
        else {
            this.cancel("Source server not running");
            return -1;
        }
        this.main.activeTransfers.set(this.transferId, this);
    }

    //Called by source, when source is prepared
    async readySource() {
        this.main.log("Waiting for target server to be ready", this.main.lp({ consoleColor: 5 }));
        this.state = "Installing";
        this.server.state.transfering = true;
    }

    //Called by source, when target is ready
    async targetReady() {
        this.main.log("Target server is ready", this.main.lp({ consoleColor: 5 }));
        this.state = "Waiting";
        try {
            if (this.server.state.restarting == false && this.server.state.delayedRestart == false) this.server.restart();
        } catch (e) {
            this.main.error("Failed restart server for transfer: {e}", this.main.lp({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
        }
    }

    //Called by target, when source is ready
    async sourceReady() {
        this.main.log("Source server is ready", this.main.lp({ consoleColor: 5 }));
        this.state = null;
        this.main.servers.set(this.server.config.id, this.server);
        this.server.start().catch(() => { });
        this.main.activeTransfers.delete(this.transferId);
    }

    //Called by target, when target is preparing
    async install() {
        this.state = "Installing";
        let result;
        try {
            result = await this.server.installApplication();
        } catch (e) {
            this.cancel(e.message);
            return;
        }
        if (result != null) {
            this.cancel("Failed to install server");
            return;
        }
        try {
            result = await this.server.configure();
        } catch (e) {
            this.cancel(e.message);
            return;
        }
        if (result != null) {
            this.cancel("Failed to configure server");
            return;
        }
        if (this.state == "Cancelled") return;
        this.state = "Starting";
        try {
            result = await this.server.start();
        } catch (e) {
            this.cancel("Failed to start server");
            return;
        }
        if (result != null) {
            this.cancel("Failed to start server");
            return;
        }
        if (this.state == "Cancelled") return;
        //Server should have started at this point, wait for it to stop;
        this.state = "Stopping";
        this.server.stop(true);
        await this.server.stop(true); //kill
        if (this.state == "Cancelled") return;
        this.state = "Waiting";
        this.main.log("Server {server} ready for transfer", this.main.lp({ server: this.server.config.label, consoleColor: 5 }));
        //Ready
        //TODO: this.main.vega.client.sendMessage(new mt.transferTargetReady(this.transferId));
    }

    //Called by any, when transfer is cancelled locally
    cancel(reason) {
        if (this.state == "Cancelled") return;
        this.main.log("Transfer cancelled: {reason}", this.main.lp({ reason: reason, consoleColor: 5 }));
        this.state = "Cancelled";
        this.main.activeTransfers.delete(this.transferId);
        //TODO: if (this.main.vega != null && this.main.vega.connected) this.main.vega.send(new mt.cancelTransfer(this.transferId, reason));
        try {
            if (this.direction == "target") {
                this.server.cancelOperation();
                this.server.uninstall();
            } else {
                this.server.state.transfering = false;
            }
        } catch (e) { }
    }
}

module.exports = serverTransfer;