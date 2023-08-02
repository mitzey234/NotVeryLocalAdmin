const pack = require('./package.json');

class pong {
    /* @type {string} */
    type;

    constructor() {
        this.type = "pong";
    }
}

class assembliesRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    id;

    serverId;

    subtype = "";

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
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

class configsRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    id;

    serverId;

    subtype = "";

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
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

class updateFile {
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

class removeFile {
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

class auth {
    /* @type {string} */
    type;

    /* @type {string} */
    token;

    /* @type {string} */
    id;

    /* @type {string} */
    label;

    /* @type {string} */
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
        this.memory = main.memory;
        this.totalMemory = main.totalMemory;
        this.lowMemory = main.lowMemory;
        this.uptime = Date.now() - main.uptime;
        if (main.network != null) this.network = main.network.trim();
    }
}

class servers {
    type = "servers";

    /** @type {Object<string, object>} */
    servers = {};

    /**
     * 
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     */
    constructor (vega) {
        let obj = {};
        vega.main.ServerManager.servers.forEach(function (s) {
            let o = {};
            o.errorState = s.errorState || null;
            o.states = s.state;
            o.players = s.players || null;
            o.tps = s.tps || null;
            o.percent = s.percent || null;
            o.steamState = s.steamState || null;
            o.cpu = s.cpu || null;
            o.memory = s.memory || null;
            o.uptime = s.uptime || null;
            o.round = s.roundStartTime || null;
            obj[s.config.id] = o;
        });
        this.servers = obj;
    }
}

class serverStateUpdate {
    type = "serverStateUpdate";

    errorState;

    /** @type {import("./classes")["serverState"]["prototype"]} */
    states;

    /** @type number */
    percent;

    /** @type Array<String> */
    players;

    /** @type string */
    serverId;

    /** @type string */
    steamState;

    /** @type number */
    cpu;

    /** @type number */
    memory;

    /** @type number */
    uptime;
    
    /** @type number */
    round;

    updatePending;

    /** @type number */
    tps;

    /** @type string */
    transferState;

    /**
     * @param {import("./classes")["Server"]["prototype"]} server
     */
    constructor (server) {
        this.serverId = server.config.id;
        this.errorState = server.errorState || null;
        this.states = server.state;
        this.players = server.players || null;
        this.tps = server.tps || null;
        this.percent = server.percent || null;
        this.steamState = server.steamState;
        this.cpu = server.cpu || null;
        this.memory = server.memory || null;
        this.uptime = server.uptime || null;
        this.round = server.roundStartTime || null;
        this.updatePending = server.updatePending || null;
        this.transferState = server.main.activeTransfers.has(server.config.id) ? server.main.activeTransfers.get(server.config.id).state : null;
    }
}

class machineStatus {
    type = "machineStatus";

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

    /** @type import("./classes")["addresses"]["prototype"] */
    network;


    /**
    * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
    */
    constructor (vega) {
        this.cpu = vega.main.cpu;
        this.memory = vega.main.memory;
        this.totalMemory = vega.main.totalMemory;
        this.lowMemory = vega.main.lowMemory;
        this.uptime = Date.now() - vega.main.uptime;
        if (vega.main.network != null) this.network = vega.main.network.trim();
    }
}

class serverConsoleLog { 
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

class machineVerkeyUpdate { 
    type = "machineVerkeyUpdate";

    /** @type string */
    data;

    constructor (data) {
        this.data = data;
    }
}

class cancelTransfer {
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

class transferTargetReady {
    type = "transferTargetReady";

    /** @type string */
    id;

    constructor (id) {
        this.id = id;
    }
}

class sourceReady {
    type = "sourceReady";

    /** @type string */
    id;

    constructor (id) {
        this.id = id;
    }
}

module.exports = {
    pong: pong,
    auth: auth,
    updateFile: updateFile,
    removeFile: removeFile,
    servers: servers,
    serverStateUpdate: serverStateUpdate,
    machineStatus: machineStatus,
    serverConsoleLog: serverConsoleLog,
    assembliesRequest: assembliesRequest,
    configsRequest: configsRequest,
    machineVerkeyUpdate: machineVerkeyUpdate,
    cancelTransfer: cancelTransfer,
    transferTargetReady: transferTargetReady,
    sourceReady: sourceReady
}