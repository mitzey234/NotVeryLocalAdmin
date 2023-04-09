const { Server } = require("../socket.js");
const fs = require("fs");
const path = require("path");
const crypto = require('crypto');
const vi = require('win-version-info')
const yaml = require('js-yaml');
const chokidar = require('chokidar');

var sockets = {};
var count = 0;

const pluginsFolder = path.join(__dirname, "./plugins");
const pluginConfigsFolder = path.join(__dirname, "./pluginConfig");
const serversFolder = path.join(__dirname, "./servers");
const customAssembliesFolder = path.join(__dirname, "./customAssemblies");
const dedicatedFilesFolder = path.join(__dirname, "./serverConfig");
const globalDedicatedFilesFolder = path.join(__dirname, "./globalConfig");
const dependenciesFolder = path.join(__dirname, "./dependencies");

if (!fs.existsSync(pluginsFolder)) fs.mkdirSync(pluginsFolder);
if (!fs.existsSync(pluginConfigsFolder)) fs.mkdirSync(pluginConfigsFolder);
if (!fs.existsSync(serversFolder)) fs.mkdirSync(serversFolder);
if (!fs.existsSync(customAssembliesFolder)) fs.mkdirSync(customAssembliesFolder);
if (!fs.existsSync(dedicatedFilesFolder)) fs.mkdirSync(dedicatedFilesFolder);
if (!fs.existsSync(dependenciesFolder)) fs.mkdirSync(dependenciesFolder);

const password = "12345";

//Files to watch
/** @type Filewatch[] */
let files = [];

/** @type Map<string,Plugin> */
let plugins = new Map();

/** @type Map<string,Assembly> */
let customAssemblies = new Map();

/** @type Map<string,Assembly> */
let dependencies = new Map();

/** @type Map<string,DedicatedFile> */
let dedicatedFiles = new Map();

/** @type Map<string,DedicatedFile> */
let globalDedicatedFiles = new Map();

/** @type Array<PluginFile> */
let pluginFiles = new Map();

/** @type Map<string,Machine> */
let machines = new Map();

/** @type Map<string,serverConfig> */
let servers = new Map();

var configFolderWatch = chokidar.watch(dedicatedFilesFolder, {ignoreInitial: true, persistent: true});
configFolderWatch.on('all', onConfigFileEvent);
configFolderWatch.on('error', error => console.log(`Watcher error: ${error}`));

async function onConfigFileEvent (event, filePath) {
  filePath = path.relative(dedicatedFilesFolder, filePath);
  if (event == "add" || event == "unlink") {
    await loadDedicatedFiles();
    sendAllMachines({type: "updateConfig", id: null});
  } else if (event == "change") {
    await loadDedicatedFiles();
    sendAllMachines({type: "updateConfig", id: null});
  }
  console.log("Config file event: " + event + " " + filePath);
}

var globalConfigFolderWatch = chokidar.watch(globalDedicatedFilesFolder, {ignoreInitial: true, persistent: true});
globalConfigFolderWatch.on('all', onGlobalConfigFileEvent);
globalConfigFolderWatch.on('error', error => console.log(`Watcher error: ${error}`));

async function onGlobalConfigFileEvent (event, filePath) {
  filePath = path.relative(globalDedicatedFilesFolder, filePath);
  if (event == "add" || event == "unlink") {
    await loadGlobalDedicatedFiles();
    sendAllMachines({type: "updateGlobalConfig", id: null});
  } else if (event == "change") {
    await loadGlobalDedicatedFiles();
    sendAllMachines({type: "updateGlobalConfig", id: null});
  }
  console.log("Global Config file event: " + event + " " + filePath);
}

var pluginConfigFolderWatch = chokidar.watch(pluginConfigsFolder, {ignoreInitial: true, persistent: true});
pluginConfigFolderWatch.on('all', onPluginConfigFileEvent);
pluginConfigFolderWatch.on('error', error => console.log(`Watcher error: ${error}`));

async function onPluginConfigFileEvent (event, filePath) {
  filePath = path.relative(pluginConfigsFolder, filePath);
  if (event == "add" || event == "unlink") {
    await readGlobalPluginConfigs();
    sendAllMachines({type: "updatePluginsConfig", id: null});
  } else if (event == "change") {
    await readGlobalPluginConfigs();
    sendAllMachines({type: "updatePluginsConfig", id: null});
  }
  console.log("Config file event: " + event + " " + filePath);
}

var pluginsFolderWatch = chokidar.watch(pluginsFolder, {ignoreInitial: true, persistent: true});
pluginsFolderWatch.on('all', onPluginsFileEvent);
pluginsFolderWatch.on('error', error => console.log(`Watcher error: ${error}`));

async function onPluginsFileEvent (event, filePath) {
  filePath = path.relative(pluginsFolder, filePath);
  if (!filePath.endsWith(".dll")) return;
  let name = path.parse(filePath).name;
  if (event == "add" || event == "change") {
    await loadPlugins();
    servers.forEach(
      /** 
       * @param {serverConfig} server
       */
    function (server) {
      if (server.plugins.includes(name) && server.assignedMachine != null && machines.has(server.assignedMachine)) {
        try {
          machines.get(server.assignedMachine).socket.sendMessage({type: "updatePlugin", name: name, data: fs.readFileSync(path.join(pluginsFolder, filePath), {encoding: "base64"})});
        } catch (e) {
          console.log("Failed plugin update: ", e);
        }
      }
    });
  } else if (event == "unlink") {
    await loadPlugins();
    servers.forEach(
      /** 
       * @param {serverConfig} server
       */
    function (server) {
      if (server.plugins.includes(name)) {
        server.plugins = server.plugins.filter(x => x != name);
        fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
        if (server.assignedMachine != null && machines.has(server.assignedMachine)) {
          try {
            machines.get(server.assignedMachine).socket.sendMessage({type: "deletePlugin", name: name});
          } catch (e) {
            console.log("Failed plugin removal: ", e);
          }
        }
      }
    });
  }
  console.log("Plugin file event: " + event + " " + filePath);
}

var dependenciesFolderWatch = chokidar.watch(dependenciesFolder, {ignoreInitial: true, persistent: true});
dependenciesFolderWatch.on('all', onDependenciesFileEvent);
dependenciesFolderWatch.on('error', error => console.log(`Watcher error: ${error}`));

async function onDependenciesFileEvent (event, filePath) {
  filePath = path.relative(dependenciesFolder, filePath);
  if (!filePath.endsWith(".dll")) return;
  let name = path.parse(filePath).name;
  if (event == "add" || event == "change") {
    await loaddependencies();
    servers.forEach(
      /** 
       * @param {serverConfig} server
       */
    function (server) {
      if (server.dependencies.includes(name) && server.assignedMachine != null && machines.has(server.assignedMachine)) {
        try {
          machines.get(server.assignedMachine).socket.sendMessage({type: "updateDependency", name: name, data: fs.readFileSync(path.join(dependenciesFolder, filePath), {encoding: "base64"})});
        } catch (e) {
          console.log("Failed Dependency update: ", e);
        }
      }
    });
  } else if (event == "unlink") {
    await loaddependencies();
    servers.forEach(
      /** 
       * @param {serverConfig} server
       */
    function (server) {
      if (server.dependencies.includes(name)) {
        server.dependencies = server.dependencies.filter(x => x != name);
        fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
        if (server.assignedMachine != null && machines.has(server.assignedMachine)) {
          try {
            machines.get(server.assignedMachine).socket.sendMessage({type: "deleteDependency", name: name});
          } catch (e) {
            console.log("Failed Dependency removal: ", e);
          }
        }
      }
    });
  }
  console.log("Dependency file event: " + event + " " + filePath);
}

var customAssembliesFolderWatch = chokidar.watch(customAssembliesFolder, {ignoreInitial: true, persistent: true});
customAssembliesFolderWatch.on('all', onCustomAssembliesFileEvent);
customAssembliesFolderWatch.on('error', error => console.log(`Watcher error: ${error}`));

async function onCustomAssembliesFileEvent (event, filePath) {
  filePath = path.relative(customAssembliesFolder, filePath);
  if (!filePath.endsWith(".dll")) return;
  let name = path.parse(filePath).name;
  if (event == "add" || event == "change") {
    await loadCustomAssemblies();
    servers.forEach(
      /** 
       * @param {serverConfig} server
       */
    function (server) {
      if (server.customAssemblies.includes(name) && server.assignedMachine != null && machines.has(server.assignedMachine)) {
        try {
          machines.get(server.assignedMachine).socket.sendMessage({type: "updateCustomAssembly", name: name, data: fs.readFileSync(path.join(customAssembliesFolder, filePath), {encoding: "base64"})});
        } catch (e) {
          console.log("Failed Custom Assembly update: ", e);
        }
      }
    });
  } else if (event == "unlink") {
    await loadCustomAssemblies();
    servers.forEach(
      /** 
       * @param {serverConfig} server
       */
    function (server) {
      if (server.customAssemblies.includes(name)) {
        server.customAssemblies = server.customAssemblies.filter(x => x != name);
        fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
        if (server.assignedMachine != null && machines.has(server.assignedMachine)) {
          try {
            machines.get(server.assignedMachine).socket.sendMessage({type: "deleteCustomAssembly", name: name});
          } catch (e) {
            console.log("Failed Custom Assembly removal: ", e);
          }
        }
      }
    });
  }
  console.log("Custom Assembly file event: " + event + " " + filePath);
}

function sendAllMachines (obj) {
  machines.forEach(function (machine) {
    machine.socket.sendMessage(this);
  }.bind(obj));
}

class Machine  {
  /** @type {import("../socket")["Client"]["prototype"]} */
  socket = null;

  /** @type {string} */
  id;

  /** @type {string} */
  label;

  /** @type {string} */
  version;

  constructor(socket, id) {
    this.socket = socket;
    this.id = id;
  }
}

class Plugin {
  /** @type string */
  version = "";

  /** @type string */
  name = "";

  /** @type string */
  author = "";

  /** @type string */
  assemblymd5 = "";

  /** @type string */
  label = "";
}

class Assembly {
  /** @type string */
  version = "";

  /** @type string */
  name = "";

  /** @type string */
  author = "";

  /** @type string */
  md5 = "";

  /** @type string */
  label = "";
}

class DedicatedFile {
  /** @type Array<string> */
  path = [];

  /** @type string */
  name = "";

  /** @type boolean */
  merging = false;

  /** @type string */
  data = null;

  /**
   * @param {string} spath
   * @param {boolean} merging
   * @param {string} data
   */
  constructor (spath = "", merging = false, data) {
    this.path = path.parse(path.normalize(spath)).dir.split(path.sep);
    this.name = path.parse(spath).base;
    this.merging = merging;
    this.data = data;
  }
}

class PluginFile {
    /** @type Array<string> */
    path = [];

    /** @type string */
    name = "";

    /** @type boolean */
    merging = false;
  
    /** data in base64 string 
     * @type string */
    data = null;
  
    /**
     * @param {string} spath
     * @param {boolean} merging
     * @param {string} data
     */
    constructor (spath = "", merging = false, data) {
      this.path = path.parse(path.normalize(spath)).dir.split(path.sep);
      this.name = path.parse(spath).base;
      this.merging = merging;
      this.data = data;
    }
  
}

class serverConfig {
  /** @type string */
  filename = null;

  /** @type string */
  label = null;

  /** @type string */
  id = null;

  /** @type DedicatedFile[] */
  dedicatedFiles = [];

  /** @type DedicatedFile[] */
  globalDedicatedFiles = [];

  /** @type string[] */
  plugins = [];

  /** @type string[] */
  customAssemblies = [];

  /** @type string[] */
  dependencies = [];

  /** @type PluginFile[] */
  pluginFiles = [];

  /** @type number */
  port = 0;

  /** @type string */
  verkey = null;

  /** @type string */
  assignedMachine = null;

  /** @type string */
  beta = null;

  /** @type string */
  betaPassword = null;

  /** @type Array<string> */
  installArguments = null;

  /** @type boolean */
  autoStart = false;

  /** @type boolean */
  dailyRestarts = false;

  /** @type restartTime */
  restartTime = new restartTime();

  simplified () {
    let obj = {};
    obj.label = this.label;
    obj.id = this.id;
    obj.port = this.port;
    obj.verkey = this.verkey;
    obj.assignedMachine = this.assignedMachine;
    obj.beta = this.beta;
    obj.betaPassword = this.betaPassword;
    obj.installArguments = this.installArguments;
    obj.dependencies = this.dependencies;
    obj.customAssemblies = this.customAssemblies;
    obj.plugins = this.plugins;
    obj.autoStart = this.autoStart;
    obj.dailyRestarts = this.dailyRestarts;
    obj.restartTime = this.restartTime;
    return obj;
  }
}

class restartTime {
  /** @type number */
  hour = 0;

  /** @type number */
  minute = 0;
}

function getAssignedServers (machine) {
  let arr = [];
  servers.forEach(server => {
    if (server.assignedMachine == machine.id) arr.push(server.simplified());
  });
  return arr;
}

const server = new Server();
server.on('listening', () => console.log("Server is listening on port " + 5555));
server.on("socket",  function(socket) {
  socket.on("close", function () {
    if (this.authed != null && machines.has(this.authed)) machines.delete(this.authed); 
    if (this.pingSystem != null) this.pingSystem.destroy();
		console.log("Connection Closed");
	});

  socket.timeout = setTimeout(() => {if (!socket.destroyed) socket.destroy();}, 5000);

  socket.on("error", function (e) {
    if (e.code != "ECONNRESET") console.log("Client Error!\n"+e);
    if (!this.destroyed) this.destroy();
  });

  socket.on("message", onMessage);
});

function onMessage (m, s) {
  //console.log("Message Recieved", m);
  if (s.authed == null) {
    if (m.type == "auth") {
      if (m.token == password && (m.id == null || !machines.has(m.id))) {
        if (m.id == null) m.id = randomId();
        s.authed = m.id;
        let machine = new Machine(s, m.id);
        machine.label = m.label || m.id;
        machine.version = m.version || "Unknown";
        machines.set(m.id, machine);
        clearTimeout(s.timeout);
        s.pingSystem = new pingSystem(s.sendMessage, s.destroy.bind(s));
        s.sendMessage({type: "auth", data: true, id: m.id});
        let servers = getAssignedServers(machine);
        s.sendMessage({type: "servers", data: servers});
        console.log("Machine Authenticated: " + m.id + " (" + machine.label + ") - " + machine.version + " - Assigned Servers: " + servers.length);
      } else {
        s.authed = false;
        s.sendMessage({type: "auth", data: false, e: (m.token != password ? "Invalid Password" : "Machine ID already in use")});
        if (!s.destroyed) s.destroy();
      }
    }
  } else {
    if (m.type == "ping") {
      s.sendMessage({type: "pong"});
    } else if (m.type == "pong" && s.pingSystem != null && s.pingSystem.inProgress) {
      s.pingSystem.resolve();
    } else if (m.type == "fileRequest" && m.id != null) {
      if (m.fileType == "dependency") {
        let filePath = path.join(dependenciesFolder, m.file)+".dll";
        if (!dependencies.has(m.file) || !fs.existsSync(filePath)) return s.sendMessage({type: "fileRequest", id: m.id, found: false});
        let data;
        try {
          data = fs.readFileSync(filePath, {encoding: 'base64'});
        } catch (e) {
          return s.sendMessage({type: "fileRequest", id: m.id, found: false, e: e.code});
        }
        console.log("Machine " + s.authed + " requested dependency " + m.file);
        s.sendMessage({type: "fileRequest", found: true, data: data, id: m.id});
      }
      if (m.fileType == "customAssembly") {
        let filePath = path.join(customAssembliesFolder, m.file)+".dll";
        if (!customAssemblies.has(m.file) || !fs.existsSync(filePath)) return s.sendMessage({type: "fileRequest", id: m.id, found: false});
        let data;
        try {
          data = fs.readFileSync(filePath, {encoding: 'base64'});
        } catch (e) {
          return s.sendMessage({type: "fileRequest", id: m.id, found: false, e: e.code});
        }
        console.log("Machine " + s.authed + " requested custom assembly " + m.file);
        s.sendMessage({type: "fileRequest", found: true, data: data, id: m.id});
      }
    } else if (m.type == "pluginConfigurationRequest" && m.id != null) {
      if (!servers.has(m.serverId)) return s.sendMessage({type: "pluginConfigurationRequest", id: m.id, e: "Server not found"});
      let server = servers.get(m.serverId);
      /** @type Map<string, PluginFile> */
      let files = new Map();
      for (i in pluginFiles) {
        let pluginFile = pluginFiles[i];
        let pf = new PluginFile();
        try {
          pf.data = fs.readFileSync(path.join(pluginConfigsFolder, joinPaths(pluginFile.path), pluginFile.name), {encoding: 'base64'});
        } catch (e) {
          console.log("Failed to load plugin file " + pluginFile.path);
          continue;
        }
        pf.path = pluginFile.path;
        pf.name = pluginFile.name;
        pf.merging = pluginFile.merging;
        files.set(path.join(joinPaths(pluginFile.path), pluginFile.name), pf);
      }
      for (x in server.pluginFiles) {
        let pluginFile = server.pluginFiles[x];
        if (files.has(path.join(joinPaths(pluginFile.path), pluginFile.name))) {
          let global = files.get(path.join(joinPaths(pluginFile.path), pluginFile.name));
          let data;
          if (global.merging && pluginFile.merging) {
            data = mergePluginFiles(global, pluginFile);
          } else {
            data = pluginFile.data;
          }
          let pf = new PluginFile();
          pf.path = pluginFile.path;
          pf.data = data;
          pf.name = pluginFile.name;
          pf.merging = pluginFile.merging;
        }
        files.set(pluginFile.path, pluginFile);
      }
      let filesArray = Array.from(files, ([name, value]) => (value));
      s.sendMessage({type: "pluginConfigurationRequest", id: m.id, found: true, files: filesArray});
    } else if (m.type == "pluginRequest" && m.id != null) {
      if (!plugins.has(m.plugin)) return s.sendMessage({type: "pluginRequest", id: m.id, e: "Plugin not found"});
      let plugin = plugins.get(m.plugin);
      let filePath = path.join(pluginsFolder, plugin.name)+".dll";
      if (!fs.existsSync(filePath)) return s.sendMessage({type: "pluginRequest", id: m.id, e: "Plugin file not found"});
      try {
        s.sendMessage({type: "pluginRequest", file: {data: fs.readFileSync(filePath, {encoding: 'base64'})}, id: m.id});
      } catch (e) {
        s.sendMessage({type: "pluginRequest", id: m.id, e: e.code});
      }
    } else if (m.type == "customAssemblyRequest" && m.id != null) {
      if (!customAssemblies.has(m.assembly)) return s.sendMessage({type: "customAssemblyRequest", id: m.id, e: "Assembly not found"});
      let assembly = customAssemblies.get(m.assembly);
      let filePath = path.join(customAssembliesFolder, assembly.name)+".dll";
      if (!fs.existsSync(filePath)) return s.sendMessage({type: "customAssemblyRequest", id: m.id, e: "Assembly file not found"});
      try {
        s.sendMessage({type: "customAssemblyRequest", file: {data: fs.readFileSync(filePath, {encoding: 'base64'})}, id: m.id});
      } catch (e) {
        s.sendMessage({type: "customAssemblyRequest", id: m.id, e: e.code});
      }
    } else if (m.type == "dependencyRequest" && m.id != null) {
      if (!dependencies.has(m.dependency)) return s.sendMessage({type: "dependencyRequest", id: m.id, e: "Dependency not found"});
      let dependency = dependencies.get(m.dependency);
      let filePath = path.join(dependenciesFolder, dependency.name)+".dll";
      if (!fs.existsSync(filePath)) return s.sendMessage({type: "dependencyRequest", id: m.id, e: "Dependency file not found"});
      try {
        s.sendMessage({type: "dependencyRequest", file: {data: fs.readFileSync(filePath, {encoding: 'base64'})}, id: m.id});
      } catch (e) {
        s.sendMessage({type: "dependencyRequest", id: m.id, e: e.code});
      }
    } else if (m.type == "dedicatedServerConfigurationRequest" && m.id != null) {
      if (!servers.has(m.serverId)) return s.sendMessage({type: "dedicatedServerConfigurationRequest", id: m.id, e: "Server not found"});
      let server = servers.get(m.serverId);
      /** @type Map<string, PluginFile> */
      let files = new Map();
      dedicatedFiles.forEach(dedicatedFile => {
        let df = new DedicatedFile();
        try {
          df.data = fs.readFileSync(path.join(dedicatedFilesFolder, joinPaths(dedicatedFile.path), dedicatedFile.name), {encoding: 'base64'});
        } catch (e) {
          console.log("Failed to load dedicated file " + dedicatedFile.path);
          return;
        }
        df.path = dedicatedFile.path;
        df.merging = dedicatedFile.merging;
        df.name = dedicatedFile.name;
        files.set(path.join(joinPaths(dedicatedFile.path), dedicatedFile.name), df);
      });
      for (x in server.dedicatedFiles) {
        let dedicatedFile = server.dedicatedFiles[x];
        if (files.has(path.join(joinPaths(dedicatedFile.path), dedicatedFile.name))) {
          let global = files.get(path.join(joinPaths(dedicatedFile.path), dedicatedFile.name));
          let data;
          if (global.merging && dedicatedFile.merging) {
            data = mergeConfigFiles(global, dedicatedFile);
          } else {
            data = dedicatedFile.data;
          }
          let df = new DedicatedFile();
          df.path = dedicatedFile.path;
          df.name = dedicatedFile.name;
          df.data = data;
          df.merging = dedicatedFile.merging;
        }
        files.set(dedicatedFile.path, dedicatedFile);
      }
      let filesArray = Array.from(files, ([name, value]) => (value));
      s.sendMessage({type: "dedicatedServerConfigurationRequest", id: m.id, found: true, files: filesArray});
    } else if (m.type == "removeConfigFile") {
      if (!servers.has(m.serverId)) return;
      let server = servers.get(m.serverId);
      server.dedicatedFiles = server.dedicatedFiles.filter(dedicatedFile => joinPaths(dedicatedFile.path) + dedicatedFile.name != joinPaths(m.path) + m.name);
      fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
      s.sendMessage({type: "updateConfig", id: server.id});
    } else if (m.type == "updateConfigFile") {
      if (!servers.has(m.serverId)) return;
      let server = servers.get(m.serverId);
      let index = server.dedicatedFiles.findIndex(dedicatedFile => joinPaths(dedicatedFile.path)+dedicatedFile.name ==  joinPaths(m.path)+m.name);
      let dedicatedFile;
      let global;
      if (dedicatedFiles.has(path.join(joinPaths(m.path), m.name))) global = dedicatedFiles.get(path.join(joinPaths(m.path), m.name));
      if (index == -1) {
        dedicatedFile = new DedicatedFile();
        dedicatedFile.path = m.path;
        dedicatedFile.name = m.name;
        dedicatedFile.merging = false;
        dedicatedFile.data = m.data;
        server.dedicatedFiles.push(dedicatedFile);
      } else {
        dedicatedFile = server.dedicatedFiles[index];
        dedicatedFile.data = global != null && global.merging && dedicatedFile.merging ? mergeConfigFiles(global, {path: dedicatedFile.path, merging: dedicatedFile.merging, data: m.data}) : m.data;
      }
      // Check if the file is the same as the global file
      if (global != null && global.data == null) global.data = fs.readFileSync(path.join(dedicatedFilesFolder, joinPaths(global.path), global.name), {encoding: "base64"});
      if (global != null && global.data == dedicatedFile.data) {
        server.dedicatedFiles = server.dedicatedFiles.filter(dedicatedFile => joinPaths(dedicatedFile.path) + dedicatedFile.name != joinPaths(m.path) + m.name);
        fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
        s.sendMessage({type: "updateConfig", id: server.id});
        return;
      }
      fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
      s.sendMessage({type: "updateConfig", id: server.id});
    } else if (m.type == "removePluginConfigFile") {
      if (!servers.has(m.serverId)) return;
      let server = servers.get(m.serverId);
      server.pluginFiles = server.pluginFiles.filter(pluginFile => joinPaths(pluginFile.path) + pluginFile.name != joinPaths(m.path) + m.name);
      fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
      s.sendMessage({type: "updatePluginsConfig", id: server.id});
    } else if (m.type == "updatePluginConfigFile") {
      if (!servers.has(m.serverId)) return;
      let server = servers.get(m.serverId);
      let index = server.pluginFiles.findIndex(pluginFile => joinPaths(pluginFile.path)+pluginFile.name ==  joinPaths(m.path)+m.name);
      let pluginFile;
      let global;
      let globalIndex = pluginFiles.findIndex(file => file.path.join(",")+"|"+file.name == m.path.join(",")+"|"+m.name);
      if (globalIndex != -1) global = pluginFiles[globalIndex];
      if (index == -1) {
        pluginFile = new PluginFile();
        pluginFile.path = m.path;
        pluginFile.name = m.name;
        pluginFile.merging = false;
        pluginFile.data = m.data;
        server.pluginFiles.push(pluginFile);
      } else {
        pluginFile = server.pluginFiles[index];
        pluginFile.data = global != null && global.merging && pluginFile.merging ? mergePluginFiles(global, {path: pluginFile.path, merging: pluginFile.merging, data: m.data}) : m.data;
      }
      // Check if the file is the same as the global file
      if (global != null && global.data == null) global.data = fs.readFileSync(path.join(pluginConfigsFolder, joinPaths(global.path), global.name), {encoding: "base64"});
      if (global != null && global.data == pluginFile.data) {
        server.pluginFiles = server.pluginFiles.filter(pluginFile => joinPaths(pluginFile.path)+pluginFile.name != joinPaths(m.path)+m.name);
        fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
        s.sendMessage({type: "updatePluginsConfig", id: server.id});
        return;
      }
      fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
      s.sendMessage({type: "updatePluginsConfig", id: server.id});
    } else if (m.type == "globalDedicatedServerConfigurationRequest") {
      if (!servers.has(m.serverId)) return s.sendMessage({type: m.type, id: m.id, e: "Server not found"});
      let server = servers.get(m.serverId);
      /** @type Map<string, PluginFile> */
      let files = new Map();
      globalDedicatedFiles.forEach(dedicatedFile => {
        let df = new DedicatedFile();
        try {
          df.data = fs.readFileSync(path.join(globalDedicatedFilesFolder, joinPaths(dedicatedFile.path), dedicatedFile.name), {encoding: 'base64'});
        } catch (e) {
          console.log("Failed to load global dedicated file " + dedicatedFile.path);
          return;
        }
        df.path = dedicatedFile.path;
        df.merging = dedicatedFile.merging;
        df.name = dedicatedFile.name;
        files.set(path.join(joinPaths(dedicatedFile.path), dedicatedFile.name), df);
      });
      for (x in server.globalDedicatedFiles) {
        let dedicatedFile = server.globalDedicatedFiles[x];
        if (files.has(path.join(joinPaths(dedicatedFile.path), dedicatedFile.name))) {
          let global = files.get(path.join(joinPaths(dedicatedFile.path), dedicatedFile.name));
          let data;
          if (global.merging && dedicatedFile.merging) {
            data = mergeGlobalConfigFiles(global, dedicatedFile);
          } else {
            data = dedicatedFile.data;
          }
          let df = new DedicatedFile();
          df.path = dedicatedFile.path;
          df.name = dedicatedFile.name;
          df.data = data;
          df.merging = dedicatedFile.merging;
        }
        files.set(path.join(joinPaths(dedicatedFile.path), dedicatedFile.name), dedicatedFile);
      }
      let filesArray = Array.from(files, ([name, value]) => (value));
      s.sendMessage({type: m.type, id: m.id, found: true, files: filesArray});
    } else if (m.type == "removeGlobalConfigFile") {
      if (!servers.has(m.serverId)) return;
      let server = servers.get(m.serverId);
      server.globalDedicatedFiles = server.globalDedicatedFiles.filter(dedicatedFile => joinPaths(dedicatedFile.path) + dedicatedFile.name != joinPaths(m.path) + m.name);
      fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
      s.sendMessage({type: "updateGlobalConfigFile", id: server.id});
    } else if (m.type == "updateGlobalConfigFile") {
      if (!servers.has(m.serverId)) return;
      let server = servers.get(m.serverId);
      let index = server.globalDedicatedFiles.findIndex(dedicatedFile => joinPaths(dedicatedFile.path)+dedicatedFile.name ==  joinPaths(m.path)+m.name);
      let dedicatedFile;
      let global;
      if (globalDedicatedFiles.has(path.join(joinPaths(m.path), m.name))) global = globalDedicatedFiles.get(path.join(joinPaths(m.path), m.name));
      if (index == -1) {
        dedicatedFile = new DedicatedFile();
        dedicatedFile.path = m.path;
        dedicatedFile.name = m.name;
        dedicatedFile.merging = false;
        dedicatedFile.data = m.data;
        server.globalDedicatedFiles.push(dedicatedFile);
      } else {
        dedicatedFile = server.globalDedicatedFiles[index];
        dedicatedFile.data = global != null && global.merging && dedicatedFile.merging ? mergeGlobalConfigFiles(global, {path: dedicatedFile.path, merging: dedicatedFile.merging, data: m.data}) : m.data;
      }
      // Check if the file is the same as the global file
      if (global != null && global.data == null) global.data = fs.readFileSync(path.join(globalDedicatedFilesFolder, joinPaths(global.path), global.name), {encoding: "base64"});
      if (global != null && global.data == dedicatedFile.data) {
        server.globalDedicatedFiles = server.globalDedicatedFiles.filter(dedicatedFile => joinPaths(dedicatedFile.path) + dedicatedFile.name != joinPaths(m.path) + m.name);
        fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
        s.sendMessage({type: m.type, id: server.id});
        return;
      }
      fs.writeFileSync(path.join(serversFolder, server.filename), JSON.stringify(server, null, 4));
      s.sendMessage({type: m.type, id: server.id});
    }
  }
}

/**
 * 
 * @param {PluginFile} global 
 * @param {PluginFile} overwrite 
 * @returns {string} Base64 encoded data
 */
function mergePluginFiles (global, overwrite) {
  if (!mergingSupported.includes(path.parse(global.name).ext)) throw "Attempted to merge unsupported file type: " + path.parse(global.name).ext;
  if (global.data == null) global.data = fs.readFileSync(path.join(pluginConfigsFolder, joinPaths(global.path), global.name), {encoding: "base64"});
  if (path.parse(global.name).ext == ".json") {
    try {
      return Buffer.from(JSON.stringify(mergeJSON(JSON.parse(Buffer.from(global.data, "base64").toString()), JSON.parse(Buffer.from(overwrite.data, "base64").toString())))).toString("base64");
    } catch (e) {
      console.log("Error merging JSON files: " + e);
    }
  } else if (path.parse(global.name).ext == ".yml" || path.parse(global.name).ext == ".yaml") {
    try {
      let globalYAML = yaml.load(Buffer.from(global.data, "base64").toString(), {schema: yaml.JSON_SCHEMA, json: true});
      let overwriteYAML = yaml.load(Buffer.from(overwrite.data, "base64").toString(), {schema: yaml.JSON_SCHEMA, json: true});
      let newData = mergeJSON(globalYAML, overwriteYAML);
      return Buffer.from(yaml.dump(newData)).toString("base64");
    } catch (e) {
      console.log("Error merging YAML files: " + e);
    }
  } else if (path.parse(global.name).ext == ".txt") {
    try {
      let globalTXT = parseTxtToObject(Buffer.from(global.data, "base64").toString());
      let overwriteTXT = parseTxtToObject(Buffer.from(overwrite.data, "base64").toString());
      let newData = new Buffer.from(objectToText(mergeJSON(globalTXT, overwriteTXT))).toString("base64");
      return newData;
    } catch (e) {
      console.log("Error merging TXT files: " + e);
    }
  }
}

/**
 * 
 * @param {DedicatedFile} global 
 * @param {DedicatedFile} overwrite 
 * @returns {string} Base64 encoded data
 */
function mergeConfigFiles (global, overwrite) {
  if (!mergingSupported.includes(path.parse(global.name).ext)) throw "Attempted to merge unsupported file type: " + path.parse(global.name).ext;
  if (global.data == null) global.data = fs.readFileSync(path.join(dedicatedFilesFolder, joinPaths(global.path), global.name), {encoding: "base64"});
  if (path.parse(global.name).ext == ".json") {
    try {
      return Buffer.from(JSON.stringify(mergeJSON(JSON.parse(Buffer.from(global.data, "base64").toString()), JSON.parse(Buffer.from(overwrite.data, "base64").toString())))).toString("base64");
    } catch (e) {
      console.log("Error merging JSON files: " + e);
    }
  } else if (path.parse(global.name).ext == ".yml" || path.parse(global.name).ext == ".yaml") {
    try {
      let globalYAML = yaml.load(Buffer.from(global.data, "base64").toString(), {schema: yaml.JSON_SCHEMA, json: true});
      let overwriteYAML = yaml.load(Buffer.from(overwrite.data, "base64").toString(), {schema: yaml.JSON_SCHEMA, json: true});
      let newData = mergeJSON(globalYAML, overwriteYAML);
      return Buffer.from(yaml.dump(newData)).toString("base64");
    } catch (e) {
      console.log("Error merging YAML files: " + e);
    }
  } else if (path.parse(global.name).ext == ".txt") {
    try {
      let globalTXT = parseTxtToObject(Buffer.from(global.data, "base64").toString());
      let overwriteTXT = parseTxtToObject(Buffer.from(overwrite.data, "base64").toString());
      let newData = new Buffer.from(objectToText(mergeJSON(globalTXT, overwriteTXT))).toString("base64");
      return newData;
    } catch (e) {
      console.log("Error merging txt files: " + e);
    }
  }
}

/**
 * 
 * @param {DedicatedFile} global 
 * @param {DedicatedFile} overwrite 
 * @returns {string} Base64 encoded data
 */
function mergeGlobalConfigFiles (global, overwrite) {
  if (!mergingSupported.includes(path.parse(global.name).ext)) throw "Attempted to merge unsupported file type: " + path.parse(global.name).ext;
  if (global.data == null) global.data = fs.readFileSync(path.join(globalDedicatedFilesFolder, joinPaths(global.path), global.name), {encoding: "base64"});
  if (path.parse(global.name).ext == ".json") {
    try {
      return Buffer.from(JSON.stringify(mergeJSON(JSON.parse(Buffer.from(global.data, "base64").toString()), JSON.parse(Buffer.from(overwrite.data, "base64").toString())))).toString("base64");
    } catch (e) {
      console.log("Error merging JSON files: " + e);
    }
  } else if (path.parse(global.name).ext == ".yml" || path.parse(global.name).ext == ".yaml") {
    try {
      let globalYAML = yaml.load(Buffer.from(global.data, "base64").toString(), {schema: yaml.JSON_SCHEMA, json: true});
      let overwriteYAML = yaml.load(Buffer.from(overwrite.data, "base64").toString(), {schema: yaml.JSON_SCHEMA, json: true});
      let newData = mergeJSON(globalYAML, overwriteYAML);
      return Buffer.from(yaml.dump(newData)).toString("base64");
    } catch (e) {
      console.log("Error merging YAML files: " + e);
    }
  } else if (path.parse(global.name).ext == ".txt") {
    try {
      let globalTXT = parseTxtToObject(Buffer.from(global.data, "base64").toString());
      let overwriteTXT = parseTxtToObject(Buffer.from(overwrite.data, "base64").toString());
      let newData = new Buffer.from(objectToText(mergeJSON(globalTXT, overwriteTXT))).toString("base64");
      return newData;
    } catch (e) {
      console.log("Error merging txt files: " + e);
    }
  }
}

function parseTxtToObject (data) {
  let o = {};
  let lines = data.replaceAll("\r", "").split("\n");
  for (i in lines) {
    /** @type string */
    let line = lines[i];
    if (line.indexOf(":") == -1 || line.startsWith("#")) continue;
    let split = line.split(":");
    if (split.length == 2) {
      o[split[0]] = split[1];
    }
  }
  return o;
}

function objectToText (obj) {
  let text = "";
  for (i in obj) {
    text += i + ": " + obj[i] + "\n";
  }
  return text;
}

function mergeJSON (global, overwrite) {
  let obj = {};
  for (i in global) {
    obj[i] = global[i];
  }
  for (i in overwrite) {
    if (typeof overwrite[i] == "object" && !Array.isArray(overwrite[i])) {
      obj[i] = mergeJSON(global[i], overwrite[i]);
    } else {
      obj[i] = overwrite[i];
    }
  }
  return obj;
}

class pingSystem {
  /** @type function */
  sendMethod = null;

  /** @type function */
  pingHostDeathMethod = null;

  /** @type number */
  failures = 0;

  /** @type boolean */
  inProgress = false;

  /** @type number */
  timeout;

  /** @type number */
  interval;

  constructor (send, death) {
      this.sendMethod = send;
      this.pingHostDeathMethod = death;
      this.interval = setInterval(this.send.bind(this), 1000);
      this.send.bind(this)();
  }

  send () {
      if (this.inProgress) return;
      this.inProgress = true;
      this.sendMethod({type: "ping"});
      this.timeout = setTimeout(this.timeoutMethod.bind(this), 5000);
  }

  timeoutMethod () {
      this.failures++;
      if (this.failures >= 3) {
          this.pingHostDeathMethod();
          clearInterval(this.interval);
      }
      this.inProgress = false;
  }

  resolve () {
      clearTimeout(this.timeout);
      this.inProgress = false;
      this.failures = 0;
  }

  destroy () {
      clearInterval(this.interval);
      clearTimeout(this.timeout);
  }
}

function randomId () {
  let id = Math.random().toString(36).slice(2);
  if (machines.has(id)) return randomId();
  return id;
}

async function getMD5 (path) {
  return new Promise((resolve, reject) => {
    let hash = crypto.createHash('md5');
    let stream = fs.createReadStream(path).pipe(hash);
    stream.once('finish', function (resolve, reject) {
      resolve(this.digest("base64"));
    }.bind(hash, resolve, reject));
  });
  
}

function isDir (target) {
  //console.log("Reading is folder:", target);
  try {
      fs.readdirSync(target);
      return true;
  } catch (e) {
      //console.log(e);
      return false;
  }
}

function joinPaths (arr) {
  var p = '';
  for (var i in arr) {
      p = path.join(p, arr[i]);
  }
  return p;
}

function readFolder(root, p = []) {
  var list = fs.readdirSync(path.join(root, joinPaths(p)));
  var files = [];
  for (i in list) {
      var target = path.join(root, joinPaths(p), list[i]);
      var targetStats = fs.statSync(target);
      if (targetStats.isDirectory() && isDir(target)) {
          files = files.concat(readFolder(root, p.concat([list[i]])));
      } else {
          var o = {filename: list[i], p: p, size: targetStats.size};
          files.push(o);
      }
  }
  return files;
}

async function loadPlugins () {
  plugins.clear();
  let filenames;
  try {
    filenames = fs.readdirSync(pluginsFolder);
  } catch (e) {
    console.log(e);
    return;
  }
  for (i in filenames) {
    let filename = filenames[i];
    if (filename.endsWith(".dll")) {
      let filePath = path.join(pluginsFolder, filename);
      let resolve = path.parse(filePath);
      let plugin = new Plugin();
      plugin.name = resolve.name;
      plugin.assemblymd5 = await getMD5(filePath);
      let info; 
      try {
        info = vi(filePath); 
      } catch (e) {
        console.log("Error reading plugin info: " + e);
        continue;
      }
      plugin.author = info.CompanyName || "Unknown Author";
      plugin.label = info.ProductName || filename.replace(".dll", "");
      plugin.version = info["Assembly Version"] || info.ProductVersion || info.FileVersion || "Unknown Version";
      if (plugin.version == "0.0.0.0") "Unknown Version";
      plugins.set(plugin.name, plugin);
      console.log("Loaded plugin '"+plugin.label+"'");
    }
  }
  console.log("Loaded " + plugins.size + " plugins");
}

async function readGlobalPluginConfigs () {
  pluginFiles = [];
  let configFolder = path.join(pluginConfigsFolder);
  let files = readFolder(configFolder);
  for (i in files) {
    let file = files[i];
    let filePath = path.join(joinPaths(file.p), file.filename);
    let pfile = new PluginFile(filePath, mergingSupported.includes(path.parse(file.filename).ext));
    pluginFiles.push(pfile);
  }
  console.log("Loaded " + pluginFiles.length + " plugin files");
}

async function loadCustomAssemblies () {
  customAssemblies.clear();
  let filenames;
  try {
    filenames = fs.readdirSync(customAssembliesFolder);
  } catch (e) {
    console.log(e);
    return;
  }
  for (i in filenames) {
    let filename = filenames[i];
    if (filename.endsWith(".dll")) {
      let filePath = path.join(customAssembliesFolder, filename);
      let resolve = path.parse(filePath);
      let assembly = new Assembly();
      assembly.name = resolve.name;
      assembly.md5 = await getMD5(filePath);
      let info = vi(filePath);
      assembly.author = info.CompanyName || "Unknown Author";
      assembly.label = info.ProductName || filename.replace(".dll", "");
      assembly.version = info["Assembly Version"] || info.ProductVersion || info.FileVersion || "Unknown Version";
      if (assembly.version == "0.0.0.0") "Unknown Version";
      customAssemblies.set(assembly.name, assembly);
      console.log("Loaded assembly '"+assembly.label+"'");
    }
  }
  console.log("Loaded " + customAssemblies.size + " assemblies");
}

async function loaddependencies () {
  dependencies.clear();
  let filenames;
  try {
    filenames = fs.readdirSync(dependenciesFolder);
  } catch (e) {
    console.log("Failed to read dependency folder:", e);
    return;
  }
  for (i in filenames) {
    let filename = filenames[i];
    if (filename.endsWith(".dll")) {
      try {
        let filePath = path.join(dependenciesFolder, filename);
        let resolve = path.parse(filePath);
        let assembly = new Assembly();
        assembly.name = resolve.name;
        assembly.md5 = await getMD5(filePath);
        let info = vi(filePath);
        assembly.author = info.CompanyName || "Unknown Author";
        assembly.label = info.ProductName || filename.replace(".dll", "");
        assembly.version = info["Assembly Version"] || info.ProductVersion || info.FileVersion || "Unknown Version";
        if (assembly.version == "0.0.0.0") "Unknown Version";
        dependencies.set(assembly.name, assembly);
        console.log("Loaded assembly '"+assembly.label+"'");  
      } catch (e) {
        console.log("Failed to load dependency '"+filename+"':", e);
        continue;
      }
    }
  }
  console.log("Loaded " + dependencies.size + " dependencies");
}

async function loadDedicatedFiles () {
  dedicatedFiles.clear();
  let files;
  try {
    files = readFolder(dedicatedFilesFolder);
  } catch (e) {
    console.log(e);
    return;
  }
  for (i in files) {
    let file = files[i];
    let filePath = path.join(joinPaths(file.p), file.filename);
    let pfile = new DedicatedFile(filePath, mergingSupported.includes(path.parse(file.filename).ext));
    dedicatedFiles.set(filePath, pfile);
  }
  console.log("Loaded " + dedicatedFiles.size + " config files");

}

async function loadGlobalDedicatedFiles () {
  globalDedicatedFiles.clear();
  let files;
  try {
    files = readFolder(globalDedicatedFilesFolder);
  } catch (e) {
    console.log(e);
    return;
  }
  for (i in files) {
    let file = files[i];
    let filePath = path.join(joinPaths(file.p), file.filename);
    let pfile = new DedicatedFile(filePath, mergingSupported.includes(path.parse(file.filename).ext));
    globalDedicatedFiles.set(filePath, pfile);
  }
  console.log("Loaded " + globalDedicatedFiles.size + " global config files");
}

async function loadServers () {
  servers.clear();
  let filenames;
  try {
    filenames = fs.readdirSync(serversFolder);
  } catch (e) {
    console.log(e);
    return;
  }
  for (i in filenames) {
    let filename = filenames[i];
    if (filename.endsWith(".json")) {
      let config;
      try {
        config = loadServerConfig(JSON.parse(fs.readFileSync(path.join(serversFolder, filename))));
        config.filename = filename;
        fs.writeFileSync(path.join(serversFolder, filename), JSON.stringify(config, null, 4));
        servers.set(config.id, config);
        console.log("Loaded server config for "+config.label+" - " + config.plugins.length + " plugins - " + config.dedicatedFiles.length + " dedicated files - " + config.dependencies.length + " dependencies - " + config.customAssemblies.length + " custom assemblies");
      } catch (e) {
        console.log("Failed loading server config '"+filename+"':\n"+e);
        continue;
      }
    }
  }
}

/**
 * @param {serverConfig} obj 
 * @returns serverConfig
 */
function loadServerConfig (obj) {
  let config = new serverConfig();
  config.label = obj.label || config.id;
  config.id = obj.id;
  config.port = obj.port;
  config.verkey = obj.verkey;
  config.assignedMachine = obj.assignedMachine;
  config.dedicatedFiles = [];
  config.beta = obj.beta;
  config.betaPassword = obj.betaPassword;
  config.installArguments = obj.installArguments;
  config.autoStart = obj.autoStart;
  config.dailyRestarts = obj.dailyRestarts || false;
  config.restartTime = obj.restartTime;
  for (i in obj.dedicatedFiles) {
    let data = obj.dedicatedFiles[i];
    if (typeof(data.data) != "string") throw "Invalid dedicated file data";
    if (!Array.isArray(data.path)) throw "Invalid dedicated file path";
    if (typeof(data.name) != "string") throw "Invalid dedicated file name";
    if (typeof(data.merging) != "boolean") throw "Invalid dedicated file merging";
    let file = new DedicatedFile("", data.merging, data.data);
    file.path = data.path;
    file.name = data.name;
    config.dedicatedFiles.push(file);
  }
  for (i in obj.globalDedicatedFiles) {
    let data = obj.globalDedicatedFiles[i];
    if (typeof(data.data) != "string") throw "Invalid global dedicated file data";
    if (!Array.isArray(data.path)) throw "Invalid global dedicated file path";
    if (typeof(data.name) != "string") throw "Invalid global dedicated file name";
    if (typeof(data.merging) != "boolean") throw "Invalid global dedicated file merging";
    let file = new DedicatedFile("", data.merging, data.data);
    file.path = data.path;
    file.name = data.name;
    config.globalDedicatedFiles.push(file);
  }
  for (i in obj.plugins) {
    let plugin = obj.plugins[i];
    if (plugins.has(plugin)) config.plugins.push(plugin);
  }
  for (i in obj.customAssemblies) {
    let assembly = obj.customAssemblies[i];
    if (customAssemblies.has(assembly)) config.customAssemblies.push(assembly);
  }
  for (i in obj.dependencies) {
    let assembly = obj.dependencies[i];
    if (dependencies.has(assembly)) config.dependencies.push(assembly);
  }
  for (i in obj.pluginFiles) {
    let data = obj.pluginFiles[i];
    if (typeof(data.data) != "string") throw "Invalid plugin file data";
    if (!Array.isArray(data.path)) throw "Invalid plugin file path";
    if (typeof(data.name) != "string") throw "Invalid plugin file name";
    if (typeof(data.merging) != "boolean") throw "Invalid plugin file merging";
    let file = new PluginFile("", data.merging, data.data);
    file.path = data.path;
    file.name = data.name;
    config.pluginFiles.push(file);
  }
  return config;
}

const mergingSupported = [".json", ".txt", ".yml", ".yaml"];

async function start () {
  await loadPlugins();
  await loadCustomAssemblies();
  await loadDedicatedFiles();
  await readGlobalPluginConfigs();
  await loadGlobalDedicatedFiles();
  await loaddependencies();
  await loadServers();
  server.listen(5555, '0.0.0.0');
}

start();