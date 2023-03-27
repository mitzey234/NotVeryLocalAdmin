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

class updateConfigFile {
    /* @type {string} */
    path;

    /* @type {string} */
    serverId;

    /* @type {string} */
    data;

    /**
     * @param {string} serverId
     * @param {string} path
     * @param {string} data
     */
    constructor (serverId, path, data) {
        this.type = "updateConfigFile";
        this.data = data;
        this.path = path;
        this.serverId = serverId;
    }
}

class removeConfigFile {
    /* @type {string} */
    path;

    /* @type {string} */
    serverId;

    /**
     * @param {string} serverId
     * @param {string} path
     * @param {string} data
     */
    constructor (serverId, path) {
        this.type = "removeConfigFile";
        this.path = path;
        this.serverId = serverId;
    }
}

class updatePluginConfigFile {
    /* @type {string} */
    path;

    /* @type {string} */
    serverId;

    /* @type {string} */
    data;

    /**
     * @param {string} serverId
     * @param {string} path
     * @param {string} data
     */
    constructor (serverId, path, data) {
        this.type = "updatePluginConfigFile";
        this.data = data;
        this.path = path;
        this.serverId = serverId;
    }
}

class removePluginConfigFile {
    /* @type {string} */
    path;

    /* @type {string} */
    serverId;

    /**
     * @param {string} serverId
     * @param {string} path
     * @param {string} data
     */
    constructor (serverId, path) {
        this.type = "removePluginConfigFile";
        this.path = path;
        this.serverId = serverId;
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

module.exports = {
    pong: pong,
    auth: auth,
    pluginConfigurationRequest: pluginConfigurationRequest,
    pluginRequest: pluginRequest,
    customAssemblyRequest: customAssemblyRequest,
    dependencyRequest: dependencyRequest,
    dedicatedServerConfigurationRequest: dedicatedServerConfigurationRequest,
    updateConfigFile: updateConfigFile,
    removeConfigFile: removeConfigFile,
    updatePluginConfigFile: updatePluginConfigFile,
    removePluginConfigFile: removePluginConfigFile
}