const { Server } = require("../socket.js");
const fs = require("fs");
const path = require("path");
const crypto = require('crypto');
const vi = require('win-version-info')

var sockets = {};
var count = 0;

const pluginsFolder = path.join(__dirname, "./plugins");
const serversFolder = path.join(__dirname, "./servers");
const customAssembliesFolder = path.join(__dirname, "./customAssemblies");
const dedicatedFilesFolder = path.join(__dirname, "./globalConfig");
const dependenciesFolder = path.join(__dirname, "./dependencies");

if (!fs.existsSync(pluginsFolder)) fs.mkdirSync(pluginsFolder);
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

/** @type Map<string,Machine> */
let machines = new Map();

/** @type Map<string,serverConfig> */
let servers = new Map();

class Machine  {
  /** @type {import("./socket.js")["Client"]} */
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

class Filewatch {

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

  /** @type Array<PluginFile> */
  files = [];
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
  /** @type string */
  path = "";

  /** @type boolean */
  merging = false;

  /** @type string */
  data = "";

  /**
   * @param {string} path
   * @param {boolean} merging
   * @param {string} data
   */
  constructor (path, merging, data) {
    this.path = path;
    this.merging = merging;
    this.data = data;
  }
}

class PluginFile {
    /** @type string */
    path = "";

    /** @type boolean */
    merging = false;
  
    /** @type Array<number> */
    data = "";
  
    constructor (path, merging) {
      this.path = path;
      this.merging = merging;
    }
  
}

class serverConfig {
  /** @type string */
  label = null;

  /** @type string */
  id = null;

  /** @type DedicatedFile[] */
  dedicatedFiles = [];

  /** @type string[] */
  plugins = [];

  /** @type string[] */
  customAssemblies = [];

  /** @type PluginFile[] */
  pluginFiles = [];

  /** @type string[] */
  dependencies = [];

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

}

function getAssignedServers (machine) {
  let arr = [];
  servers.forEach(server => {
    if (server.assignedMachine == machine.id) arr.push(server);
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
        s.sendMessage({type: "auth", data: false});
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
    }
  }
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
      let info = vi(filePath);
      plugin.author = info.CompanyName || "Unknown Author";
      plugin.label = info.ProductName || filename.replace(".dll", "");
      plugin.version = info["Assembly Version"] || info.ProductVersion || info.FileVersion || "Unknown Version";
      if (plugin.version == "0.0.0.0") "Unknown Version";

      let configFolder = path.join(pluginsFolder, plugin.name);
      try {
        if (!fs.existsSync(configFolder)) fs.mkdirSync(configFolder);
      } catch (e) {
        console.log("Failed making config folder for plugin '"+plugin.label+"':\n"+ e);
        continue;
      }
      let files = readFolder(configFolder);
      for (i in files) {
        let file = files[i];
        let filePath = path.join(joinPaths(file.p), file.filename);
        let pfile = new PluginFile(filePath, mergingSupported.includes(path.parse(file.filename).ext));
        plugin.files.push(pfile);
      }
      plugins.set(plugin.name, plugin);
      console.log("Loaded plugin '"+plugin.label+"' - " + plugin.files.length + " files");
    }
  }
  console.log("Loaded " + plugins.size + " plugins");
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
    console.log(e);
    return;
  }
  for (i in filenames) {
    let filename = filenames[i];
    if (filename.endsWith(".dll")) {
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
  console.log("Loaded " + dedicatedFiles.size + " global config files");

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
 * 
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
  for (i in obj.dedicatedFiles) {
    let data = obj.dedicatedFiles[i];
    if (typeof(data.data) != "string") throw "Invalid dedicated file data";
    if (typeof(data.path) != "string") throw "Invalid dedicated file path";
    if (typeof(data.merging) != "boolean") throw "Invalid dedicated file merging";
    let file = new DedicatedFile(data.path, data.merging, data.data);
    config.dedicatedFiles.push(file);
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
    if (typeof(data.data) != "string") throw "Invalid dedicated file data";
    if (typeof(data.path) != "string") throw "Invalid dedicated file path";
    if (typeof(data.merging) != "boolean") throw "Invalid dedicated file merging";
    let file = new PluginFile(data.path, data.merging, data.data);
    config.pluginFiles.push(file);
  }
  return config;
}

const mergingSupported = [".json", ".txt", ".yml", ".yaml"];

async function start () {
  await loadPlugins();
  await loadCustomAssemblies();
  await loadDedicatedFiles();
  await loaddependencies();
  await loadServers();
  server.listen(5555, '0.0.0.0');
}

start();