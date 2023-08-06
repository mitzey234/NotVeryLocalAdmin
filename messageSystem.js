const fs = require("fs");
const pingSystem = require("./pingSystem");
const mt = require("./messageTemplates.js");
const path = require("path");
const Classes = require("./classes");

function joinPaths (arr) {
    var p = '';
    if (arr.length == 1 && arr[0].trim() == "") return "";
    for (let i in arr) p = path.join(p, arr[i]);
    return p;
}

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

    log(arg, obj, meta) {
        this.vega.logger.info(arg, obj != null ? Object.assign(obj, {messageType: "vega-"+this.constructor.name}) : {messageType: "vega-"+this.constructor.name}, meta);
      }
    
      error(arg, obj, meta) {
        this.vega.logger.error(arg, Object.assign(obj, {messageType: "vega-"+this.constructor.name}), meta);
      }
    
      verbose(arg, obj, meta) {
        this.vega.logger.verbose(arg, Object.assign(obj, {messageType: "vega-"+this.constructor.name}), meta);
      }
}

class auth extends messageType {
    /* @type {boolean} */
    data;

    /* @type {string} */
    id;

    /* @type {string} */
    e;

    httpPort;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.data == null || obj.data == undefined) throw "type 'auth' requires 'data'";
        this.data = obj.data;
        if (obj.data != null && obj.data == true && (obj.id == null || obj.id == undefined)) throw "type 'auth' requires 'id'";
        this.httpPort = obj.httpPort;
        this.id = obj.id;
        this.e = obj.e;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.data == true && this.httpPort != null) {
            this.vega.httpPort = this.httpPort;
            this.vega.log("Vega download server at: {host}:{port}", {host:this.main.config.vega.host, port:this.httpPort}, {color: 6});
            s.pingSystem = new pingSystem(s.sendMessage, this.vega.serverTimeout.bind(this.vega));
            this.vega.log("Vega Connection completed", {messageType: this.constructor.name}, {color: 10});
            if (this.main.config.vega.id == null && this.id != null) {
                this.main.config.vega.id = this.id;
                fs.writeFileSync("./config.json", JSON.stringify(this.main.config, null, 4));
            }
            this.vega.onAuthenticated();
        } else {
            this.vega.error("Vega Connection rejected: {e}", {e: this.e});
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
                if (!server.installed) await server.install();
                else await server.configure();
                if (!fs.existsSync(server.serverContainer)) fs.mkdirSync(server.serverContainer, {recursive: true});
                fs.writeFileSync(path.join(server.serverContainer, "config.json"), JSON.stringify(this.data[i], null, 4));
                fs.writeFileSync(path.join(server.serverContainer, server.config.label + ".txt"), "This file is only here to help identify the server's label in the file system for a user. It is not used by the server or NVLA in any way.");
            } catch (e) {
                this.error("Failed to install server: {e} ", {e: e != null ? e.code || e.message : e, stack: e.stack});
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
        if (obj.id == null || obj.id == undefined) throw "type 'pluginConfigurationRequest' requires 'id'";
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



class configRequest extends messageType {
    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** File object
     * @type {Array<import("./classes")["FileInfo"]["prototype"]>}} */
    files;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'configRequest' requires 'id'";
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
classes.set(configRequest.name, configRequest);

class assembliesRequest extends messageType {
    /** @type {string} */
    id;

    /** Error codes thrown if any
     *  @type {string} */
    e;

    /** File object
     * @type {Array<import("./classes")["FileInfo"]["prototype"]>}} */
    files;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'assembliesRequest' requires 'id'";
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
classes.set(assembliesRequest.name, assembliesRequest);


class updateAssembly extends messageType {
    /** @type {string} */
    subType;

    /** @type {string} */
    name;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.subType == null || obj.subType == undefined) throw "type 'updateAssembly' requires 'subType'";
        if (obj.name == null || obj.name == undefined) throw "type 'updateAssembly' requires 'name'";
        this.name = obj.name;
        this.subType = obj.subType;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        let property;
        let method;
        if (this.subType == "plugin") {
            property = "plugins";
            method = "getPlugins";
        } else if (this.subType == "customAssembly") {
            property = "customAssemblies";
            method = "getCustomAssemblies";
        } else if (this.subType == "dependency") {
            property = "dependencies";
            method = "getDependencies";
        }
        this.main.ServerManager.servers.forEach(async server => {
            if (property == "customAssemblies") await server.update(true);
            if (server.config[property].includes(this.name)) server[method].bind(server)();
        });
    }    
}
classes.set(updateAssembly.name, updateAssembly);

class deleteAssembly extends messageType {
    /** @type {string} */
    subType;

    /** @type {string} */
    name;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
        constructor(main, obj) {
        super(main, obj);
        if (obj.subType == null || obj.subType == undefined) throw "type 'deleteAssembly' requires 'subType'";
        if (obj.name == null || obj.name == undefined) throw "type 'deleteAssembly' requires 'name'";
        this.name = obj.name;
        this.subType = obj.subType;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        let property;
        let method;
        if (this.subType == "plugin") {
            property = "plugins";
            method = "getPlugins";
        } else if (this.subType == "customAssembly") {
            property = "customAssemblies";
            method = "getCustomAssemblies";
        } else if (this.subType == "dependency") {
            property = "dependencies";
            method = "getDependencies";
        }
        this.main.ServerManager.servers.forEach(async server => {
            if (property == "customAssemblies") await server.update(true);
            if (server.config[property].includes(this.name)) await server[method].bind(server)();
        });
    }    
}
classes.set(deleteAssembly.name, deleteAssembly);




class updateFile extends messageType {
    /** @type {string} Server id*/
    id;

    /** @type {string} file type */
    fileType;

    /** @type {Classes.FileInfo} file path */
    file;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'updateFile' requires 'id'";
        if (obj.fileType == null || obj.fileType == undefined) throw "type 'updateFile' requires 'fileType'";
        if (obj.file == null || obj.file == undefined) throw "type 'updateFile' requires 'file'";
        this.id = obj.id;
        this.fileType = obj.fileType;
        this.file = obj.file;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        //console.log("Updaing: " + this.file.path + " - " + this.file.name + " - " + this.file.type + " - " + this.type);
        if (this.main.ServerManager.servers.has(this.id)) {
            let server = this.main.ServerManager.servers.get(this.id);
            if (server.state.installing || server.state.configuring) return;
            try {
                let reset;
                let lockFiles;
                if (this.fileType == "globalServerConfig") {
                    reset = server.resetGlobalServerConfigWatcher.bind(server);
                    lockFiles = server.globalConfigLockfiles;
                } else if (this.fileType == "serverConfig") { 
                    reset = server.resetServerConfigWatcher.bind(server);
                    lockFiles = server.configLockfiles;
                } else if (this.fileType == "pluginConfig") {
                    reset = server.resetPluginConfigWatcher.bind(server);
                    lockFiles = server.pluginLockfiles;
                } else {
                    server.error("Remote update - Unknown file type {ftype}", {ftype: this.fileType});
                    return;
                }
                await server.getConfig(this.fileType, this.file);
                //await reset();
                //lockFiles.clear();
            } catch (e) {
                server.error("Failed to perform config file update: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(updateFile.name, updateFile);

class deleteFile extends messageType {
    /** @type {string} Server id*/
    id;

    /** @type {Array<string>} file path */
    path;

    /** @type {string} file name */
    name;

    /** @type {string} file type */
    fileType;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'deleteFile' requires 'id'";
        if (obj.path == null || obj.path == undefined) throw "type 'deleteFile' requires 'path'";
        if (obj.name == null || obj.name == undefined) throw "type 'deleteFile' requires 'name'";
        if (obj.fileType == null || obj.fileType == undefined) throw "type 'deleteFile' requires 'fileType'";
        this.id = obj.id;
        this.path = obj.path;
        this.name = obj.name;
        this.fileType = obj.fileType;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        //console.log("Deleting: " + this.path + " - " + this.name + " - " + this.fileType);
        if (this.main.ServerManager.servers.has(this.id)) {
            let server = this.main.ServerManager.servers.get(this.id);
            if (server == null) return;
            if (server.state.installing || server.state.configuring) return;
            let file = this;
            let filePath;
            let lockFiles;
            let resetListener;
            switch (this.fileType) {
                case 'globalServerConfig':
                    filePath = path.join(server.globalDedicatedServerConfigFiles, joinPaths(file.path), file.name);
                    lockFiles = server.globalConfigLockfiles;
                    resetListener = server.resetGlobalServerConfigWatcher.bind(server);
                    break;
                case 'serverConfig':
                    filePath = path.join(server.serverConfigsFolder, joinPaths(file.path), file.name);
                    lockFiles = server.configLockfiles;
                    resetListener = server.resetServerConfigWatcher.bind(server);
                    break;
                case 'pluginConfig':
                    filePath = path.join(server.pluginsFolderPath, joinPaths(file.path), file.name);
                    lockFiles = server.pluginLockfiles;
                    resetListener = server.resetPluginConfigWatcher.bind(server);
                  break;
                default:
                  this.error("Unknown file type {type}", {type: this.fileType});
                  return;
            }
            server.log("Deleting: {path}", { path: joinPaths(file.path) + path.sep + file.name });
            if (!fs.existsSync(path.parse(filePath).dir)) return;
            try {
                if (!fs.existsSync(filePath)) return;
                lockFiles.set(path.join(joinPaths(file.path), file.name), 1);
                fs.rmSync(filePath);
            } catch (e) {
                server.error("Failed to delete global dedicated server config file: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
            //resetListener();
            //lockFiles.clear();
        }
    }
}
classes.set(deleteFile.name, deleteFile);




class consoleCommand extends messageType {
    /** @type {string} Server id*/
    serverid;

    /** @type {string} command */
    command;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'consoleCommand' requires 'serverid'";
        if (obj.command == null || obj.command == undefined) throw "type 'consoleCommand' requires 'command'";
        this.serverid = obj.serverid;
        this.command = obj.command;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Executing console command: {command}", { command: this.command });
            try {
                server.command(this.command);
            } catch (e) {
                server.error("Failed to execute console command: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(consoleCommand.name, consoleCommand);

class stopServer extends messageType {
    /** @type {string} Server id*/
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'stopServer' requires 'serverid'";
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web shutting down server");
            try {
                server.stop(false, false);
            } catch (e) {
                server.error("Failed to shutdown server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(stopServer.name, stopServer);

class forceStopServer extends messageType {
    /** @type {string} Server id*/
    serverid;

    /** @type {boolean} use kill*/
    kill;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'forceStopServer' requires 'serverid'";
        if (obj.kill == null || obj.kill == undefined) throw "type 'forceStopServer' requires 'kill'";
        this.serverid = obj.serverid;
        this.kill = obj.kill;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web force shutting down server");
            try {
                server.stop(true, this.kill);
            } catch (e) {
                server.error("Failed to force shut down server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(forceStopServer.name, forceStopServer);

class restartServer extends messageType {
    /** @type {string} Server id*/
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'restartServer' requires 'serverid'";
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web restarting server");
            try {
                server.restart(false, false);
            } catch (e) {
                server.error("Failed to restart server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(restartServer.name, restartServer);

class forceRestartServer extends messageType {
    /** @type {string} Server id*/
    serverid;

    /** @type {boolean} use kill*/
    kill;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'forceRestartServer' requires 'serverid'";
        if (obj.kill == null || obj.kill == undefined) throw "type 'forceRestartServer' requires 'kill'";
        this.serverid = obj.serverid;
        this.kill = obj.kill;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web force restarting server");
            try {
                server.restart(true, this.kill);
            } catch (e) {
                server.error("Failed to force restart server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(forceRestartServer.name, forceRestartServer);

class startServer extends messageType {
    /** @type {string} Server id*/
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'startServer' requires 'serverid'";
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web starting server");
            try {
                server.start().catch(e => {});
            } catch (e) {
                server.error("Failed to start server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(startServer.name, startServer);

class cancelServerOperation extends messageType {
    /** @type {string} Server id*/
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'cancelServerOperation' requires 'serverid'";
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web canceling server operation");
            try {
                server.cancelAction();
            } catch (e) {
                server.error("Failed to cancel server operation: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(cancelServerOperation.name, cancelServerOperation);

class clearErrorState extends messageType {
    /** @type {string} Server id*/
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'clearErrorState' requires 'serverid'";
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Clearing error state");
            server.errorState = null;
        }
    }
}
classes.set(clearErrorState.name, clearErrorState);

class updateServer extends messageType {
    /** @type {string} Server id*/
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'updateServer' requires 'serverid'";
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
     async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web updating server");
            try {
                server.update();
            } catch (e) {
                server.error("Failed to update server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
        }
    }
}
classes.set(updateServer.name, updateServer);


class uninstallServer extends messageType {
    /** @type {string} Server id*/
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'uninstallServer' requires 'serverid'";
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.main.ServerManager.servers.has(this.serverid)) {
            let server = this.main.ServerManager.servers.get(this.serverid);
            server.log("Web uninstalling server");
            let result
            try {
                result = await server.uninstall();
            } catch (e) {
                server.error("Failed to uninstall server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
                return;
            }
            if (result != null) {
                server.error("Failed to uninstall server: {e}", {e: result});
                return;
            }
            this.main.ServerManager.servers.delete(server.config.id);
        }
    }
}
classes.set(uninstallServer.name, uninstallServer);

class installServer extends messageType {
    /** @type {Classes["ServerConfig"]["prototype"]} Server id*/
    server;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.server == null || obj.server == undefined) throw "type 'installServer' requires 'server'";
        this.server = obj.server;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        let server;
        if (this.main.ServerManager.servers.has(this.server.id)) server = this.main.ServerManager.servers.get(this.server.id);
        else server = new this.exports.Server(this.main, this.server);
        server.log("Web installing server");
        server.config = this.server;
        this.main.ServerManager.servers.set(this.server.id, server);
        try {
            if (!server.installed) await server.install();
            else await server.configure();
            if (!fs.existsSync(server.serverContainer)) fs.mkdirSync(server.serverContainer, {recursive: true});
            fs.writeFileSync(path.join(server.serverContainer, "config.json"), JSON.stringify(this.server, null, 4));
            fs.writeFileSync(path.join(server.serverContainer, server.config.label + ".txt"), "This file is only here to help identify the server's label in the file system for a user. It is not used by the server or NVLA in any way.");
        } catch (e) {
            this.error("Failed to install server: {e} ", {e: e != null ? e.code || e.message : e, stack: e.stack});
            server.error = e;
        }
    }
}
classes.set(installServer.name, installServer);

class updateServerConfig extends messageType {
    /** @type {Classes["ServerConfig"]["prototype"]} Server config*/
    data;

    /** @type string id */
    serverid;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.data == null || obj.data == undefined) throw "type 'updateServerConfig' requires 'data'";
        if (obj.serverid == null || obj.serverid == undefined) throw "type 'updateServerConfig' requires 'serverid'";
        this.data = obj.data;
        this.serverid = obj.serverid;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        let server;
        if (!this.main.ServerManager.servers.has(this.serverid)) return;
        server = this.main.ServerManager.servers.get(this.serverid);
        server.log("Web editing server");
        let oldLabel = server.config.label;
        server.config = this.data;
        this.main.ServerManager.servers.set(this.serverid, server);
        try {
            if (!server.installed) await server.install();
            else await server.configure();
            if (!fs.existsSync(server.serverContainer)) fs.mkdirSync(server.serverContainer, {recursive: true});
            fs.writeFileSync(path.join(server.serverContainer, "config.json"), JSON.stringify(this.data, null, 4));
            if (fs.existsSync(path.join(server.serverContainer, oldLabel + ".txt"))) fs.unlinkSync(path.join(server.serverContainer, oldLabel + ".txt"));
            fs.writeFileSync(path.join(server.serverContainer, server.config.label + ".txt"), "This file is only here to help identify the server's label in the file system for a user. It is not used by the server or NVLA in any way.");
        } catch (e) {
            this.error("Failed to install server: {e} ", {e: e != null ? e.code || e.message : e, stack: e.stack});
            server.error = e;
        }
    }    
}
classes.set(updateServerConfig.name, updateServerConfig);


class queryRequest extends messageType {
    /** @type {object}*/
    data;

    /** @type string */
    requestType;

    /** @type string */
    id;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'queryRequest' requires 'id'";
        if (obj.requestType == null || obj.requestType == undefined) throw "type 'queryRequest' requires 'requestType'";
        this.data = obj.data;
        this.requestType = obj.requestType;
        this.id = obj.id;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.requestType == "machineConfig") {
            let data = JSON.parse(JSON.stringify(this.main.config, null));
            s.sendMessage({type: "queryResponse", id: this.id, data: data});
        }
    }    
}
classes.set(queryRequest.name, queryRequest);


class stopMachine extends messageType {

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        this.log("Web requested machine shutdown");
        this.main.shutdown();
    }    
}
classes.set(stopMachine.name, stopMachine);

class restartMachine extends messageType {

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        this.log("Web requested machine restart");
        this.main.restart();
    }    
}
classes.set(restartMachine.name, restartMachine);

class editConfig extends messageType {
    /** @type {object}*/
    data;

    /** @type string */
    property;

    /** @type string */
    subProperty;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.property == null || obj.property == undefined) throw "type 'editConfig' requires 'property'";
        this.data = obj.data;
        this.property = obj.property;
        this.subProperty = obj.subProperty;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        this.log("Web changed machine config");
        let config = this.main.config;
        let previousValue;
        if (this.subProperty != null && this.subProperty != undefined) {
            if (config[this.subProperty] == null || config[this.subProperty] == undefined) config[this.subProperty] = {};
            previousValue = config[this.subProperty][this.property];
            config[this.subProperty][this.property] = this.data;
        } else {
            previousValue = config[this.property]
            config[this.property] = this.data;
        }
        this.main.config = config;
        fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(this.main.config, null, 4));
        try {
            await this.main.handleConfigEdit(this.property, this.subProperty, previousValue);
        } catch (e) {
            this.error("Failed to handle config edit: {e} ", {e: e != null ? e.code || e.message : e, stack: e.stack});
        }
    }    
}
classes.set(editConfig.name, editConfig);



class startTransfer extends messageType {
    /** @type string */
    id;

    /** @type string */
    direction;

    /** @type Classes.ServerConfig */
    server;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'startTransfer' requires 'id'";
        if (obj.direction == null || obj.direction == undefined) throw "type 'startTransfer' requires 'direction'";
        if (obj.server == null || obj.server == undefined) throw "type 'startTransfer' requires 'server'";
        this.id = obj.id;
        this.direction = obj.direction;
        this.server = obj.server;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (this.main.activeTransfers.has(this.id)) return;
        new this.exports.serverTransfer(this.server, this.main, this.direction);
    }
}
classes.set(startTransfer.name, startTransfer);

class cancelTransfer extends messageType {
    /** @type string */
    id;

    /** @type string */
    reason;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'cancelTransfer' requires 'id'";
        if (obj.reason == null || obj.reason == undefined) throw "type 'cancelTransfer' requires 'reason'";
        this.id = obj.id;
        this.reason = obj.reason;
    }

    /** 
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (!this.main.activeTransfers.has(this.id)) return;
        this.main.activeTransfers.get(this.id).cancel(this.reason);
    }
}
classes.set(cancelTransfer.name, cancelTransfer);

class targetReady extends messageType {
    /** @type string */
    id;

    /**
     * @param main {messageHandler}
     * @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'targetReady' requires 'id'";
        this.id = obj.id;
    }

    /**
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (!this.main.activeTransfers.has(this.id)) return;
        this.main.activeTransfers.get(this.id).targetReady();
    }
}
classes.set(targetReady.name, targetReady);


class sourceReady extends messageType {
    /** @type string */
    id;

    /**
     * @param main {messageHandler}
     *  @param obj {object} */
    constructor(main, obj) {
        super(main, obj);
        if (obj.id == null || obj.id == undefined) throw "type 'sourceReady' requires 'id'";
        this.id = obj.id;
    }

    /**
     * @param {import("./socket")["Client"]["prototype"]} s */
    async execute(s) {
        if (!this.main.activeTransfers.has(this.id)) return;
        this.main.activeTransfers.get(this.id).sourceReady();
    }
}
classes.set(sourceReady.name, sourceReady);


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
                try {
                    obj.execute(...opts);
                } catch (e) {
                    this.vega.error.bind(this.vega)("Message handler exception type: " + m.type + "\n" + e.toString(), {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
                }
            } else {
                this.vega.log.bind(this.vega)("Unknown message type: " + m.type);
                //this.vega.log("Unknown message type: " + m.type);
            }
        }
    }    
}

module.exports = messageHandler;