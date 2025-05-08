//This is designed for classes used in the server class
class Module {
    /**
     * @param {import("./core.js")["Main"]["prototype"]} core 
     */
    constructor(core) {
        this.main = core;
    }

    log(...args) {
        this.main.log(...args, this.main.lp({serverId: this.id, serverName: this.label}));
    }

    error(...args) {
        this.main.error(...args, this.main.lp({serverId: this.id, serverName: this.label}));
    }

    verbose(...args) {
        this.main.debug(...args, this.main.lp({serverId: this.id, serverName: this.label}));
    }

    warn(...args) {
        this.main.warn(...args, this.main.lp({serverId: this.id, serverName: this.label}));
    }
}

module.exports = Module;