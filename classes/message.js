const Util = require("./util.js");

class messageType {
    /** @type {import("./vega.js")} */
    main;

    get core () {
        return this.main?.main;
    }

    /** @type string */
    type = "unknown";

    /**
     * @param {import("./vega.js")} main
     */
    constructor(main) {
        if (!main || main.constructor.name != "Vega") throw new Error("Vega main is required");
        this.main = main;
        this.lp = this.core.lp;
        this.type = this.constructor.name;
    }

    log(...arg) {
        this.core.log(...arg);
    }

    debug(...arg) {
        this.core.debug(...arg);
    }

    warn(...arg) {
        this.core.warn(...arg);
    }

    error(...arg) {
        this.core.error(...arg);
    }

    handle () {}

    toObject () {
        return Util.filterSerializableProperties(this, "main");
    }
}

module.exports = messageType;