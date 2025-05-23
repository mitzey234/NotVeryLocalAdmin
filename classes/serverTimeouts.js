module.exports = {
    /** @this {import("./server")} */
    startTimeout: function () {
        this.error("{serverName} Startup took too long, stopped", this.main.lp({serverName: this.config.label}));
        this.timeout = null;
        try {
            this.process.kill(9);
        } catch (e) {
            this.error("Failed killing server process {e}", this.main.lp({e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
        }
        this.state.error = "Server startup took too long, check console";
    },
    /** @this {import("./server")} */
    delayedRestart: function () {
        this.error("{serverName} Setting delayed restart took too long, the server may not be responding!", this.main.lp({serverName: this.config.label}));
        this.timeout = null;
    },
    /** @this {import("./server")} */
    restart: function () {
        this.error("{serverName} Restart took too long, forcing", this.main.lp({serverName: this.config.label}));
        this.timeout = null;
        this.process.kill(9);
    },
    stopTimeout: function () {
        this.error("{serverName} Shutdown took too long, forcing", {serverName: this.config.label});
        this.timeout = null;
        this.process.kill(9);
    }
}