const fs = require("fs");
const pingSystem = require("./pingSystem");

let classes = new Map();

class messageType {
    /** @type {import("./classes")["NVLA"]["prototype"]} */
    main;

    /** @type {import("./classes")["NVLA"]["prototype"]["vega"]} */
    vega;

    /** @type {messageHandler} */
    messageHandler;

    /** @type {import("./classes")} */
    exports;

    /**
     * @param messageHandler {messageHandler}
     * @param obj {object} */
    constructor(messageHandler, obj) {
        this.main = messageHandler.main;
        this.vega = messageHandler.vega;
        this.messageHandler = messageHandler;
        this.exports = messageHandler.exports;
    }
}

class auth extends messageType {
    /* @type {boolean} */
    data;

    /* @type {string} */
    id;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.data == null || obj.data == undefined) throw "type 'auth' requires 'data'";
        this.data = obj.data;
        if (obj.id == null || obj.id == undefined) throw "type 'auth' requires 'id'";
        this.id = obj.id;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.data == true) {
            s.pingSystem = new pingSystem(s.sendMessage, this.vega.serverTimeout.bind(this.vega));
            this.vega.log.bind(this)("Vega Connection completed");
            if (this.main.config.vega.id == null && this.id != null) {
                this.main.config.vega.id = this.id;
                fs.writeFileSync("./config.json", JSON.stringify(this.main.config, null, 4));
            }
            this.vega.onAuthenticated();
        }
    }
}
classes.set(auth.name, auth);

class ping extends messageType {
    /**
     * @param main {messageHandler}
     * @param obj {object} */
     constructor(main, obj) {
        super(main, obj);
     }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        s.sendMessage({type: "pong"});
    }
}
classes.set(ping.name, ping);

class pong extends messageType {
    /**
     * @param main {messageHandler}
     * @param obj {object} */
     constructor(main, obj) {
        super(main, obj);
     }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        s.pingSystem.resolve();
    }
}
classes.set(pong.name, pong);


class servers extends messageType {
    /** @type {Array<import("./classes.js")["ServerConfig"]["prototype"]>} */
    data;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
     constructor(main, obj) {
        super(main, obj);
        if (obj.data == null || obj.data == undefined) throw "type 'servers' requires 'data'";
        this.data = obj.data;
     }

    async execute() {
        for (i in this.data) {
            let server = new this.exports.Server (this.main, this.data[i]);
            this.main.ServerManager.servers.set(this.data[i].id, server);
            try {
                server.install();
            } catch (e) {
                this.main.error.bind(this)("Failed to install server:", e);
                server.error = e;
            }
        }
    }
}
classes.set(servers.name, servers);

class fileRequest extends messageType {

    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** If the file was loaded or not 
     * @type {boolean} */
    found;

    /** Base64 encoded file data
     * @type {string} */
    data;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
     constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'fileRequest' requires 'id'";
        this.id = obj.id;
        this.e = obj.e;
        if (obj.found == null || obj.found == undefined) throw "type 'fileRequest' requires 'found'";
        this.found = obj.found;
        this.data = obj.data;
     }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.vega.fileRequests.has(this.id)) {
            let request = this.vega.fileRequests.get(this.id);
            if (this.e) return request.reject(this.e);
            if (!this.found) return request.reject("File load error");
            request.resolve(Buffer.from(this.data, "base64"));
            this.vega.fileRequests.delete(this.id);
        }
    }
}
classes.set(fileRequest.name, fileRequest);


class messageHandler {
    /** @type {import("./classes")["NVLA"]["prototype"]} */
    main;

    /** Map<string, messageType> */
    types;

    /** @type {import("./classes")["Vega"]["prototype"]} */
    vega;

    /** @type {import("./classes")} */
    exports;

    /** @param {import("./classes")["Vega"]["prototype"]} vega */
    constructor(vega, exports) {
        this.main = vega.main;
        this.vega = vega;
        this.types = classes;
        this.exports = exports;
    }

    /**
     * 
     * @param m {object}
     */
    handle(m, ...opts) {
        if (m.type != null && m.type != undefined) {
            let type = this.types.get(m.type);
            if (type != null && type != undefined) {
                let obj = new type(this, m);
                obj.execute(...opts);
            } else {
                this.vega.log.bind(this.vega)("Unknown message type: " + m.type);
                //this.vega.log("Unknown message type: " + m.type);
            }
        }
    }    
}



module.exports = messageHandler;