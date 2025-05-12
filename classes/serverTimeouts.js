module.exports = {
    /** @this {import("./server")} */
    startTimeout: function () {
        this.error("{label} Startup took too long, stopped", this.main.lp({label: this.config.label}));
        this.timeout = null;
        try {
            this.process.kill();
        } catch (e) {
            this.error("Failed killing server process {e}", this.main.lp({e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
        }
        this.state.error = "Server startup took too long, check console";
    },
    /** @this {import("./server")} */
    delayedRestart: function () {
        this.error("{label} Setting delayed restart took too long, the server may not be responding!", this.main.lp({label: this.config.label}));
        this.timeout = null;
    },
    /** @this {import("./server")} */
    restart: function () {
        this.error("{label} Restart took too long, forcing", this.main.lp({label: this.config.label}));
        this.timeout = null;
        this.process.kill();
    },
    stopTimeout: function () {
        this.error("{label} Shutdown took too long, forcing", {label: this.config.label});
        this.timeout = null;
        this.process.kill();
    }
}