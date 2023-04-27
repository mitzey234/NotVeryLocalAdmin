const pack = require('./package.json');

class pong {
    /* @type {string} */
    type;

    constructor() {
        this.type = "pong";
    }
}

class pluginConfigurationRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    serverId;

    /* @type {string} */
    id;

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
     * @param {string} serverId
     */
    constructor (vega, promise, serverId) {
        this.type = "pluginConfigurationRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
        this.serverId = serverId;
    }
}

class pluginRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    plugin;

    /* @type {string} */
    id;

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
     * @param {string} plugin
     */
    constructor (vega, promise, plugin) {
        this.type = "pluginRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
        this.plugin = plugin;
    }
}

class customAssemblyRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    assembly;

    /* @type {string} */
    id;

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
     * @param {string} assembly
     */
    constructor (vega, promise, assembly) {
        this.type = "customAssemblyRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
        this.assembly = assembly;
    }
}

class dependencyRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    dependency;

    /* @type {string} */
    id;

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
     * @param {string} dependency
     */
    constructor (vega, promise, dependency) {
        this.type = "dependencyRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
        this.dependency = dependency;
    }
}

class dedicatedServerConfigurationRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    serverId;

    /* @type {string} */
    id;

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
     * @param {string} serverId
     */
    constructor (vega, promise, serverId) {
        this.type = "dedicatedServerConfigurationRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
        this.serverId = serverId;
    }
}

class globalDedicatedServerConfigurationRequest {
    /* @type {string} */
    type;

    /* @type {string} */
    serverId;

    /* @type {string} */
    id;

    /**
     * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
     * @param {object} promise object
     * @param {string} serverId
     */
    constructor (vega, promise, serverId) {
        this.type = "globalDedicatedServerConfigurationRequest";
        this.id = vega.randomFileRequestId();
        vega.fileRequests.set(this.id, promise);
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

    /**
     * @param {import("./classes")["Server"]["prototype"]} server
     */
    constructor (server) {
        this.serverId = server.config.id;
        this.errorState = server.errorState || null;
        this.states = server.state;
        this.players = server.players || null;
        this.percent = server.percent || null;
        this.steamState = server.steamState;
        this.cpu = server.cpu || null;
        this.memory = server.memory || null;
        this.uptime = server.uptime || null;
        this.round = server.roundStartTime || null;
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


    /**
    * @param {import("./classes")["NVLA"]["prototype"]["vega"]} vega
    */
    constructor (vega) {
        this.cpu = vega.main.cpu;
        this.memory = vega.main.memory;
        this.totalMemory = vega.main.totalMemory;
        this.lowMemory = vega.main.lowMemory;
        this.uptime = Date.now() - vega.main.uptime;
    }
}

module.exports = {
    pong: pong,
    auth: auth,
    pluginConfigurationRequest: pluginConfigurationRequest,
    pluginRequest: pluginRequest,
    customAssemblyRequest: customAssemblyRequest,
    dependencyRequest: dependencyRequest,
    dedicatedServerConfigurationRequest: dedicatedServerConfigurationRequest,
    updateFile: updateFile,
    globalDedicatedServerConfigurationRequest: globalDedicatedServerConfigurationRequest,
    removeFile: removeFile,
    servers: servers,
    serverStateUpdate: serverStateUpdate,
    machineStatus: machineStatus
}