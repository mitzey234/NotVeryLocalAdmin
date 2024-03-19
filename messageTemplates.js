const pack = require('./package.json');
module.exports = {};

module.exports.pong = class {
    /** @type {string} */
    type;

    constructor() {
        this.type = "pong";
    }
}

module.exports.assembliesRequest = class {
    /** @type {string} */
    type;

    /** @type {string} */
    id;

    serverId;

    subtype = "";

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise
     * @param {string} type
     * @param {string} serverId
     */
    constructor (vega, promise, type, serverId) {
        this.type = "assembliesRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
        this.subtype = type;
        this.serverId = serverId;
    }
}

module.exports.configsRequest = class {
    /** @type {string} */
    type;

    /** @type {string} */
    id;

    serverId;

    subtype = "";

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise
     * @param {string} type
     * @param {string} serverId
     */
    constructor (vega, promise, type, serverId) {
        this.type = "configsRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
        this.subtype = type;
        this.serverId = serverId;
    }
}

module.exports.updateFile = class {
    /** @type {Array<string>} */
    path;

    /** @type {string} */
    name;

    /** @type {string} */
    serverId;

    /** @type {string} */
    data;

    /** @type {string} */
    fileType;

    /**
     * @param {string} serverId
     * @param {string} path
     * @param {string} data
     */
    constructor (serverId, path, name, data, fileType) {
        this.type = "updateFile";
        this.data = data;
        this.path = path;
        if (this.path.length == 1 && this.path[0] == "") this.path = [];
        this.name = name;
        this.serverId = serverId;
        this.fileType = fileType;
    }
}

module.exports.removeFile = class {
    /** @type {Array<string>} */
    path;

    /** @type {string} */
    name;

    /** @type {string} */
    serverId;

    /** @type {string} */
    fileType;

    /**
     * @param {string} serverId
     * @param {string} path
     * @param {string} data
     * @param {string} fileType
     */
    constructor (serverId, path, name, fileType) {
        this.type = "removeFile";
        this.path = path;
        if (this.path.length == 1 && this.path[0] == "") this.path = [];
        this.serverId = serverId;
        this.name = name;
        this.fileType = fileType;
    }
}

module.exports.auth = class {
    /** @type {string} */
    type;

    /** @type {string} */
    token;

    /** @type {string} */
    id;

    /** @type {string} */
    label;

    /** @type {string} */
    version;

    /** @type number */
    cpu;

    /** @type number */
    memory;

    /** @type boolean */
    lowMemory;

    /** @type number */
    uptime;

    /** @type number */
    totalMemory;

    /** @type Classes.addresses */
    network;

    /**
     * @param {import("./classes")["NVLA"]["prototype"]} main 
     * @param {*} obj 
     */
    constructor(main) {
        this.type = "auth";
        this.token = main.config.vega.password;
        this.id = main.config.vega.id;
        this.label = main.config.vega.label;
        this.version = pack.version;
        this.cpu = main.cpu;
        this.memory = main.memoryMonitor.memory;
        this.totalMemory = main.memoryMonitor.totalMemory;
        this.lowMemory = main.memoryMonitor.lowMemory;
        this.uptime = main.uptime;
        if (main.network != null) this.network = main.network.toObject();
    }
}

module.exports.servers = class {
    type = "servers";
    /** @type {{[key: string]: object}} */
    servers = {};

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     */
    constructor (vega) {
        let obj = {};
        vega.main.servers.forEach(function (s) {
            let o = {};
            o.state = s.state.toObject();
            o.players = s.state.players || null;
            o.tps = s.state.tps || null;
            o.cpu = s.state.cpu || null;
            o.memory = s.state.memory || null;
            o.uptime = s.state.uptime || null;
            o.round = s.state.roundStartTime || null;
            o.id = s.config.id || null;
            obj[s.config.id] = o;
        });
        this.servers = obj;
    }
}

module.exports.fullServerInfo = class {
    type = "fullServerInfo";

    server;

    /**
     * @param {import("./classes")["Server"]["prototype"]} s 
     */
    constructor (s) {
        let o = {};
        o.id = s.config.id;
        o.states = s.state.toObject();
        o.players = s.state.players || null;
        o.tps = s.state.tps || null;
        o.cpu = s.state.cpu || null;
        o.memory = s.state.memory || null;
        o.uptime = s.state.uptime || null;
        o.round = s.state.roundStartTime || null;
        this.server = o;
    }
}

module.exports.serverRemoved = class {
    type = "serverRemoved";

    server;

    /**
     * @param {import("./classes")["Server"]["prototype"]} s 
     */
    constructor (s) {
        this.server = s.config.id;
    }
}

module.exports.serverStateUpdate = class {
    type = "serverStateUpdate";

    server;

    /** @type {{server: {import("./classes")["Server"]["prototype"]}, key: string, value: Object}} */
    data;

    /**
     * @param {{server: import("./classes")["Server"]["prototype"], key: string, value: object}} data
     */
    constructor (data) {
        this.server = data.server.config.id;
        delete data.server;
        this.data = data;
    }
}

module.exports.transferStateUpdate = class {
    type = "transferStateUpdate";

    server;

    /** @type {{server: {import("./classes")["Server"]["prototype"]}, key: string, value: Object}} */
    data;

    /**
     * @param {{server: import("./classes")["Server"]["prototype"], key: string, value: object}} data
     */
    constructor (data) {
        this.server = data.server.config.id;
        delete data.server;
        this.data = data;
    }
}

module.exports.machineStateUpdate = class {
    type = "machineStateUpdate";

    /** @type {{key: string, subKey: string, value: Object}} */
    data;

    /**
     * @param {{key: string, subKey: string, value: object}} data
     */
    constructor (data) {
        this.data = data;
    }
}

module.exports.serverConsoleLog = class { 
    type = "serverConsoleLog";

    /** @type string */
    serverId;

    /** @type string */
    log;

    /** @type number */
    color;

    /** @type number */
    stamp;

    constructor (serverId, log, color) {
        this.serverId = serverId;
        this.log = log;
        this.color = color;
        this.stamp = Date.now();
    }
}

module.exports.machineVerkeyUpdate = class { 
    type = "machineVerkeyUpdate";

    /** @type string */
    data;

    constructor (data) {
        this.data = data;
    }
}

module.exports.cancelTransfer = class {
    type = "cancelTransfer";

    /** @type string */
    id;

    /** @type string */
    reason;

    constructor (id, reason) {
        this.id = id;
        this.reason = reason;
    }
}

module.exports.transferTargetReady = class {
    type = "transferTargetReady";

    /** @type string */
    id;

    constructor (id) {
        this.id = id;
    }
}

module.exports.sourceReady = class {
    type = "sourceReady";

    /** @type string */
    id;

    constructor (id) {
        this.id = id;
    }
}