const fs = require("fs");
const pingSystem = require("./pingSystem");
const mt = require("./messageTemplates.js");
const path = require("path");
const chokidar = require('chokidar');

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

    /* @type {string} */
    e;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.data == null || obj.data == undefined) throw "type 'auth' requires 'data'";
        this.data = obj.data;
        if (obj.data != null && obj.data == true && (obj.id == null || obj.id == undefined)) throw "type 'auth' requires 'id'";
        this.id = obj.id;
        this.e = obj.e;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.data == true) {
            s.pingSystem = new pingSystem(s.sendMessage, this.vega.serverTimeout.bind(this.vega));
            this.vega.log("Vega Connection completed", {messageType: this.constructor.name}, {color: 10});
            if (this.main.config.vega.id == null && this.id != null) {
                this.main.config.vega.id = this.id;
                fs.writeFileSync("./config.json", JSON.stringify(this.main.config, null, 4));
            }
            this.vega.onAuthenticated();
        } else {
            this.vega.log.bind(this)("Vega Connection rejected: " + this.e);
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
        s.sendMessage(new mt.pong());
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
        for (var i in this.data) {
            let server;
            if (this.main.ServerManager.servers.has(this.data[i].id)) server = this.main.ServerManager.servers.get(this.data[i].id);
            else server = new this.exports.Server(this.main, this.data[i]);
            server.config = this.data[i];
            this.main.ServerManager.servers.set(this.data[i].id, server);
            try {
                if (!server.installed && false) await server.install();
                else await server.configure();
                if (!fs.existsSync(server.serverContainer)) fs.mkdirSync(server.serverContainer, {recursive: true});
                fs.writeFileSync(path.join(server.serverContainer, "config.json"), JSON.stringify(this.data[i], null, 4));
                fs.writeFileSync(path.join(server.serverContainer, server.config.label + ".txt"), "This file is only here to help identify the server's label in the file system for a user. It is not used by the server or NVLA in any way.");
            } catch (e) {
                this.vega.error("Failed to install server: {e} ", {messageType: this.constructor.name, e: e.code || e.message, stack: e.stack});
                server.error = e;
            }
        }
        this.main.ServerManager.servers.forEach(async function (server, id) {
            var safe = false;
            for (var i in this.data) {
                /** @type import("./classes.js")["ServerConfig"]["prototype"] */
                let config = this.data[i];
                if (config.id == id) safe = true;
            }
            if (!safe) {
                await server.uninstall();
                this.main.ServerManager.servers.delete(id);
            }
        }.bind(this));
        let files;
        try {
            files = fs.readdirSync(this.main.config.serversFolder);
        } catch (e) {
            this.vega.error("Failed to read servers folder: {e}", {messageType: this.constructor.name, e: e.code, stack: e.stack});
            return;
        }
        for (var i in files) {
            if (!this.main.ServerManager.servers.has(files[i])) {
                try {
                    fs.rmSync(path.join(this.main.config.serversFolder, files[i]), {recursive: true});
                } catch (e) {
                    this.vega.error("Failed to delete item '{item}' in servers folder: {e}", {messageType: this.constructor.name, item: files[i], e: e.code, stack: e.stack});
                }
            }
        }
    }
}
classes.set(servers.name, servers);

class removeServer extends messageType {
    /** @type {Array<import("./classes.js")["ServerConfig"]["prototype"]>} */
    serverId;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.serverId == null || obj.serverId == undefined) throw "type 'removeServer' requires 'serverId'";
        this.serverId = obj.serverId;
        }

    async execute() {
        if (!this.main.ServerManager.servers.has(this.serverId)) return;
        try {
            await this.main.ServerManager.servers.get(this.serverId).uninstall();
            this.main.ServerManager.servers.delete(this.serverId);
        } catch (e) {
            this.main.error.bind(this)("Failed to uninstall server:", e);
        }
    }
}
classes.set(removeServer.name, removeServer);

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

class pluginConfigurationRequest extends messageType {
    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** File objects
     * @type {Array<import("./classes")["File"]["prototype"]}>} */
    files;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'fileRequest' requires 'id'";
        this.id = obj.id;
        this.e = obj.e;
        this.files = obj.files;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.vega.fileRequests.has(this.id)) {
            let request = this.vega.fileRequests.get(this.id);
            if (this.e) return request.reject(this.e);
            request.resolve(this.files);
            this.vega.fileRequests.delete(this.id);
        }
    }    
}
classes.set(pluginConfigurationRequest.name, pluginConfigurationRequest);

class pluginRequest extends messageType {
    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** File object
     * @type {import("./classes")["File"]["prototype"]}} */
    file;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'fileRequest' requires 'id'";
        this.id = obj.id;
        this.e = obj.e;
        this.file = obj.file;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.vega.fileRequests.has(this.id)) {
            let request = this.vega.fileRequests.get(this.id);
            if (this.e) return request.reject(this.e);
            request.resolve(this.file);
            this.vega.fileRequests.delete(this.id);
        }
    }    
}
classes.set(pluginRequest.name, pluginRequest);

class customAssemblyRequest extends messageType {
    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** File object
     * @type {import("./classes")["File"]["prototype"]}} */
    file;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'fileRequest' requires 'id'";
        this.id = obj.id;
        this.e = obj.e;
        this.file = obj.file;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.vega.fileRequests.has(this.id)) {
            let request = this.vega.fileRequests.get(this.id);
            if (this.e) return request.reject(this.e);
            request.resolve(this.file);
            this.vega.fileRequests.delete(this.id);
        }
    }
}
classes.set(customAssemblyRequest.name, customAssemblyRequest);

class dependencyRequest extends messageType {
    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** File object
     * @type {import("./classes")["File"]["prototype"]}} */
    file;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'fileRequest' requires 'id'";
        this.id = obj.id;
        this.e = obj.e;
        this.file = obj.file;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.vega.fileRequests.has(this.id)) {
            let request = this.vega.fileRequests.get(this.id);
            if (this.e) return request.reject(this.e);
            request.resolve(this.file);
            this.vega.fileRequests.delete(this.id);
        }
    }
}
classes.set(dependencyRequest.name, dependencyRequest);

class dedicatedServerConfigurationRequest extends messageType {
    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** File objects
     * @type {Array<import("./classes")["File"]["prototype"]}>} */
    files;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'fileRequest' requires 'id'";
        this.id = obj.id;
        this.e = obj.e;
        this.files = obj.files;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.vega.fileRequests.has(this.id)) {
            let request = this.vega.fileRequests.get(this.id);
            if (this.e) return request.reject(this.e);
            request.resolve(this.files);
            this.vega.fileRequests.delete(this.id);
        }
    }    
}
classes.set(dedicatedServerConfigurationRequest.name, dedicatedServerConfigurationRequest);

class updateConfig extends messageType {
    /** @type {string} Server id if specific*/
    id;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        this.id = obj.id;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.id != null) {
            if (this.main.ServerManager.servers.has(this.id)) {
                let server = this.main.ServerManager.servers.get(this.id);
                await server.stopWatchers();      
                try {
                    await server.getDedicatedServerConfigFiles();
                } catch (e) {
                    this.main.log.bind(this)("Failed to update config files for server " + this.id);
                }
                await server.setupWatchers();
            }
        } else {
            this.main.ServerManager.servers.forEach(async function (server, id) {
                await server.stopWatchers();
                try {
                    await server.getDedicatedServerConfigFiles();
                } catch (e) {
                    this.main.log.bind(this)("Failed to update config files for server " + id);
                }
                await server.setupWatchers();
            }.bind(this));
        }
    }
}
classes.set(updateConfig.name, updateConfig);

class updatePluginsConfig extends messageType {
    /** @type {string} Server id if specific*/
    id;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        this.id = obj.id;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.id != null) {
            if (this.main.ServerManager.servers.has(this.id)) {
                let server = this.main.ServerManager.servers.get(this.id);
                try {
                    await server.getPluginConfigFiles();
                } catch (e) {
                    this.main.log.bind(this)("Failed to update plugin config files for server " + this.id);
                }
            }
        } else {
            this.main.ServerManager.servers.forEach(async function (server, id) {
                try {
                    await server.getPluginConfigFiles();
                } catch (e) {
                    this.main.log.bind(this)("Failed to update plugin config files for server " + id);
                }
            }.bind(this));
        }
    }
}
classes.set(updatePluginsConfig.name, updatePluginsConfig);

class updatePlugin extends messageType {
    /** @type {string} Name of plugin*/
    name;

    /** @type {string} Base64 string of plugin data*/
    data;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.name == null || obj.name == undefined) throw "type 'updatePlugin' requires 'name'";
        if (obj.data == null || obj.data == undefined) throw "type 'updatePlugin' requires 'data'";
        this.name = obj.name;
        this.data = obj.data;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        this.main.log.bind(this)("Updating plugin " + this.name);
        this.main.ServerManager.servers.forEach(
            /**
             * @param {import("./classes")["Server"]["prototype"]} server
             * @param {string} id
             */
            async function (server, id) {
            try {
                if (server.config.plugins.includes(this.name)) {
                    fs.writeFileSync(path.join(server.pluginsFolderPath, this.name+".dll"), this.data, {encoding: "base64"});
                    if (server.process != null) server.updatePending = true;
                }
            } catch (e) {
                this.main.log.bind(this)("Failed to update plugin " + this.name + " for server " + id, e);
            }
        }.bind(this));
    }
}
classes.set(updatePlugin.name, updatePlugin);

class deletePlugin extends messageType {
    /** @type {string} Name of plugin*/
    name;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.name == null || obj.name == undefined) throw "type 'deletePlugin' requires 'name'";
        this.name = obj.name;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        this.main.log.bind(this)("Deleting plugin " + this.name);
        this.main.ServerManager.servers.forEach(
            /**
             * @param {import("./classes")["Server"]["prototype"]} server
             * @param {string} id
             */
            async function (server, id) {
            try {
                if (server.config.plugins.includes(this.name)) {
                    server.config.plugins.splice(server.config.plugins.indexOf(this.name), 1);
                    fs.writeFileSync(path.join(server.serverContainer, "config.json"), JSON.stringify(server.config, null, 4));
                    fs.rmSync(path.join(server.pluginsFolderPath, this.name+".dll"));
                    if (server.process != null) server.updatePending = true;
                }
            } catch (e) {
                this.main.log.bind(this)("Failed to delete plugin " + this.name + " for server " + id, e);
            }
        }.bind(this));
    }
}
classes.set(deletePlugin.name, deletePlugin);

class updateDependency extends messageType {
    /** @type {string} Name of Dependency*/
    name;

    /** @type {string} Base64 string of Dependency data*/
    data;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.name == null || obj.name == undefined) throw "type 'updateDependency' requires 'name'";
        if (obj.data == null || obj.data == undefined) throw "type 'updateDependency' requires 'data'";
        this.name = obj.name;
        this.data = obj.data;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        this.main.log.bind(this)("Updating Dependency " + this.name);
        this.main.ServerManager.servers.forEach(
            /**
             * @param {import("./classes")["Server"]["prototype"]} server
             * @param {string} id
             */
            async function (server, id) {
            try {
                if (server.config.dependencies.includes(this.name)) {
                    fs.writeFileSync(path.join(server.pluginsFolderPath, "dependencies", this.name+".dll"), this.data, {encoding: "base64"});
                    if (server.process != null) server.updatePending = true;
                }
            } catch (e) {
                this.main.log.bind(this)("Failed to update Dependency " + this.name + " for server " + id, e);
            }
        }.bind(this));
    }
}
classes.set(updateDependency.name, updateDependency);

class deleteDependency extends messageType {
    /** @type {string} Name of Dependency*/
    name;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.name == null || obj.name == undefined) throw "type 'deleteDependency' requires 'name'";
        this.name = obj.name;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        this.main.log.bind(this)("Deleting Dependency " + this.name);
        this.main.ServerManager.servers.forEach(
            /**
             * @param {import("./classes")["Server"]["prototype"]} server
             * @param {string} id
             */
            async function (server, id) {
            try {
                if (server.config.dependencies.includes(this.name)) {
                    server.config.dependencies.splice(server.config.dependencies.indexOf(this.name), 1);
                    fs.writeFileSync(path.join(server.serverContainer, "config.json"), JSON.stringify(server.config, null, 4));
                    fs.rmSync(path.join(server.pluginsFolderPath, "dependencies", this.name+".dll"));
                    if (server.process != null) server.updatePending = true;
                }
            } catch (e) {
                this.main.log.bind(this)("Failed to delete Dependency " + this.name + " for server " + id, e);
            }
        }.bind(this));
    }
}
classes.set(deleteDependency.name, deleteDependency);

class updateCustomAssembly extends messageType {
    /** @type {string} Name of Dependency*/
    name;

    /** @type {string} Base64 string of Dependency data*/
    data;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.name == null || obj.name == undefined) throw "type 'updateCustomAssembly' requires 'name'";
        if (obj.data == null || obj.data == undefined) throw "type 'updateCustomAssembly' requires 'data'";
        this.name = obj.name;
        this.data = obj.data;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        this.main.log.bind(this)("Updating Custom Assembly " + this.name);
        this.main.ServerManager.servers.forEach(
            /**
             * @param {import("./classes")["Server"]["prototype"]} server
             * @param {string} id
             */
            async function (server, id) {
            try {
                if (server.config.customAssemblies.includes(this.name)) {
                    fs.writeFileSync(path.join(server.serverCustomAssembliesFolder, this.name+".dll"), this.data, {encoding: "base64"});
                    if (server.process != null) server.updatePending = true;
                }
            } catch (e) {
                this.main.log.bind(this)("Failed to update Custom Assembly " + this.name + " for server " + id, e);
            }
        }.bind(this));
    }
}
classes.set(updateCustomAssembly.name, updateCustomAssembly);

class deleteCustomAssembly extends messageType {
    /** @type {string} Name of Dependency*/
    name;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.name == null || obj.name == undefined) throw "type 'deleteCustomAssembly' requires 'name'";
        this.name = obj.name;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        this.main.log.bind(this)("Deleting Custom Assembly " + this.name);
        this.main.ServerManager.servers.forEach(
            /**
             * @param {import("./classes")["Server"]["prototype"]} server
             * @param {string} id
             */
            async function (server, id) {
            try {
                if (server.config.customAssemblies.includes(this.name)) {
                    server.config.customAssemblies.splice(server.config.customAssemblies.indexOf(this.name), 1);
                    fs.writeFileSync(path.join(server.serverContainer, "config.json"), JSON.stringify(server.config, null, 4));
                    if (server.process != null) server.updatePending = true;
                }
            } catch (e) {
                this.main.log.bind(this)("Failed to delete Custom Assembly " + this.name + " for server " + id, e);
            }
        }.bind(this));
    }
}
classes.set(deleteCustomAssembly.name, deleteCustomAssembly);


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