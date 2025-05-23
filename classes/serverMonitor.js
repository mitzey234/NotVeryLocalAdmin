const LP = require("./logging").LP;
const Module = require("./module");

class ServerMonitor extends Module {
    /** @type import("./server") */
    server;

    /**
     * @param {import("./server")} s 
     */
    constructor(s) {
        super(s.main);
        this.server = s;
    }

    /** @type boolean */
    checkInProgress = false;

    /** @type Function */
    checkCallback;

    checkTimeout;

    monitorTimeout;

    updateInterval;

    checkTimeoutCount = 0;

    /** @type boolean */
    _nvlaMonitorInstalled = false;

    /** @type boolean */
    _enabled = false;

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        if (value == this._enabled) return;
        if (value == true) {
            if (this.updateInterval != null) clearInterval(this.updateInterval);
            this.updateInterval = setInterval(this.update.bind(this), 1000);
            this.checkTimeoutCount = 0;
            if (this.checkTimeout != null) clearTimeout(this.checkTimeout);
            this.checkTimeout = null;
            if (this.monitorTimeout != null) clearTimeout(this.monitorTimeout);
            this.monitorTimeout = null;
        } else {
            if (this.updateInterval != null) clearInterval(this.updateInterval);
            this.updateInterval = null;
            if (this.checkTimeout != null) clearTimeout(this.checkTimeout);
            this.checkTimeout = null;
            if (this.monitorTimeout != null) clearTimeout(this.monitorTimeout);
            this.monitorTimeout = null;
            this._nvlaMonitorInstalled = false;
        }
    }

    get nvlaMonitorInstalled() {
        return this._nvlaMonitorInstalled;
    }

    set nvlaMonitorInstalled(value) {
        if (value == this._nvlaMonitorInstalled) return;
        this._nvlaMonitorInstalled = value;
        if (value == true && this._enabled) {
            this.log("NVLA Monitor detected", new LP({ color: 3 }));
            if (this.updateInterval != null) clearInterval(this.updateInterval);
            this.updateInterval = setInterval(this.update.bind(this), 1000);
        } else {
            if (this.updateInterval != null) clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    async update() {
        if (this.server.state.running && this.server.process != null && this.checkInProgress == false && this.nvlaMonitorInstalled == false) {
            this.checkInProgress = true;
            try {
                await this.checkServer();
            } catch (e) {
                if (e == "Timeout") {
                    this.main.error("Failed to check server, server timed out {count}", new LP({count: this.checkTimeoutCount, color: 4 }));
                    this.checkTimeoutCount++;
                    if (this.checkTimeoutCount >= this.server.config.maximumServerUnresponsiveTime / 8) {
                        this.error("Server is unresponsive, restarting", new LP({ color: 4 }));
                        this.server.state.restarting = true;
                        this.server.process.kill(9);
                    }
                } else {
                    this.error("Failed to check server, code: {e}", new LP({ e: e }));
                }
            }
            this.checkCallback = null;
            this.checkTimeout = null;
            this.checkInProgress = false;
        }
    }

    /**
     * @param {{players: Array<string>, tps: number}} data 
     */
    onMonitorUpdate(data) {
        if (!this.server.state.running) return;
        if (this.nvlaMonitorInstalled == false) {
            this.nvlaMonitorInstalled = true;
            this.log("NVLA Monitor detected", new LP({ color: 3 }));
            if (this.checkTimeout != null) {
                clearTimeout(this.checkTimeout);
                this.checkTimeout = null;
            }
            if (this.checkCallback != null) {
                this.checkCallback();
                this.checkCallback = null;
            }
            this.checkInProgress = false;
        }
        this.server.state.players = data.players.length;
        this.server.state.tps = data.tps;
        if (this.server.state.idleMode) this.server.state.tps = -1;
        clearTimeout(this.monitorTimeout);
        this.checkTimeoutCount = 0;
        this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.server.state.idleMode ? 60000 * 5 : 8000);
        return;
    }

    monitorUpdateTimeout() {
        if (!this.server.state.running) return;
        this.error("Failed to check server, NVLA Monitor timed out {count}", new LP({count: this.checkTimeoutCount, color: 4 }));
        this.checkTimeoutCount++;
        if (this.checkTimeoutCount >= this.server.config.maximumServerUnresponsiveTime / 8) {
            this.error("Server is unresponsive, restarting", new LP({ color: 4 }));
            this.server.state.restarting = true;
            this.server.process.kill(9);
        } else {
            clearTimeout(this.monitorTimeout);
            this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.server.state.idleMode ? 60000 * 5 : 8000);
        }
    }

    async checkServer() {
        if (this.server.process == null) return;
        return new Promise((resolve, reject) => {
            this.checkCallback = resolve;
            this.checkTimeout = setTimeout(reject.bind(null, "Timeout"), 8000);
            this.server.command("list", true);
        });
    }
}

module.exports = ServerMonitor;