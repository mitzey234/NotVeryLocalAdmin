const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn, fork } = require("child_process");
const EventEmitter = require("events");
const pty = require("node-pty");
const { Client } = require("./socket.js");
const pack = require("./package.json");
const crypto = require("crypto");
const Net = require("net");
const messageHandler = require("./messageSystem.js");
const mt = require("./messageTemplates.js");
const chokidar = require("chokidar");
const chalk = require("chalk");
require("winston-daily-rotate-file");
const winston = require("winston");
const pidusage = require('pidusage')
const util = require("util");
const Stream = require('stream');
const osAlt = require('os-utils');
const os = require('os');

function getCPUPercent () {
    return new Promise((resolve, reject) => {
        osAlt.cpuUsage(function(resolve, reject, v){
            resolve(Math.round(v*100));
        }.bind(null,resolve, reject));
    });
}

var defaultSteamPath = [__dirname, "steam"];
var defaultServersPath = [__dirname, "servers"];

const ansiStripRegexPattern = [
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
  "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
].join("|");
const ansiStripRegex = new RegExp(ansiStripRegexPattern, "g");

let colors = {
  0: chalk.black,
  1: chalk.blue,
  2: chalk.green,
  3: chalk.cyan,
  4: chalk.red,
  5: chalk.magenta,
  6: chalk.yellow,
  7: chalk.white,
  8: chalk.gray,
  9: chalk.blueBright,
  10: chalk.greenBright,
  11: chalk.cyanBright,
  12: chalk.redBright,
  13: chalk.magentaBright,
  14: chalk.yellowBright,
  15: chalk.gray,
};

var events = {
  16: "RoundRestart",
  17: "IdleEnter",
  18: "IdleExit",
  19: "ExitActionReset",
  20: "ExitActionShutdown",
  21: "ExitActionSilentShutdown",
  22: "ExitActionRestart"
}

let objectTypes = {
  Server:
    /**\
     * @param {Server} server 
     * @param {object} info 
     * @returns 
     */
    function (server, info) {
      info.serverId = server.config.id;
      info.name = server.config.label;
      return "Server";
    },
};

let consoleObjectTypes = {
  Server:
    /**\
     * @param {Server} server 
     * @param {object} info 
     * @returns 
     */
    function (server, info) {
      info.serverId = server.config.id;
      info.name = server.config.label;
      return info.name;
    },
};

function currTime(date) {
  const d = new Date();
  const str =
    (date ? `${d.getMonth() + 1}/${d.getDate()} ` : "") +
    `${d.toTimeString().slice(0, 8)}.${d
      .getMilliseconds()
      .toString()
      .padStart(3, "0")}`;
  return str;
}

function toInt32 (int) {
  int = int.toString(16);
  while (int.length < 8) int = "0"+int;
  var arr = [];
  for (i = 0; i<int.length/2; i++) arr[i] = int[i*2] + int[i*2+1];
  var arr2 = [];
  for (i = 0; i<arr.length; i++) arr2[i] = arr[arr.length-i-1];
  return Buffer.from(arr2.join(""), "hex");
}

function processPrintF(info, seq) {
	let data = (info[Symbol.for("splat")] || [])[0] || [];
	let metadata = (info[Symbol.for("splat")] || [])[1] || [];
  if (info.message == null) info.message = "";
  info.message = info.message.toString();
	if (typeof data == "object" && !seq) for (i in data) if (i != "type") info.message = info.message.replaceAll("{" + i + "}", typeof data[i] != "string" && (data[i] != null && data[i].constructor != null ? data[i].constructor.name != "Error" : true) ? util.inspect(data[i], false, 7, false) : data[i].toString());
  if (metadata.color != null && seq) info.consoleColor = metadata.color;
	if (metadata.color != null && colors[metadata.color] != null && !seq) info.message = colors[metadata.color](info.message);
	if (!seq) info.message = info.message + (info.stack != null ? "\n" + info.stack : "");
	if (!seq) info.message = info.message.replaceAll("\r", "").split("\n");
	if (!seq) for (i in info.message) info.message[i] = `[${currTime(true)}] ${info.type != null ? `[${resolveType(info.type, info, seq)}] ` : "" }` + info.message[i];
	if (!seq) info.message = info.message.join("\n");
	if (seq && info.type != null) {
		info.type = resolveType(info.type, info, seq);
	}
}

function resolveType(type, info, seq) {
  if (info == null) info = {};
  if (info.messageType != null && typeof type == "string") return info.messageType;
  if (typeof type == "string") {
    if (objectTypes[type] != null) {
      var t = objectTypes[type];
      if (!seq && consoleObjectTypes[type] != null) t = consoleObjectTypes[type];
      return typeof t == "function" ? t(type, info) : t;
    } else return type;
  } else if (typeof type == "object") {
    if (type.constructor == null) return "Unknown";
    let res = type.constructor.name;
    if (objectTypes[res] != null) {
      var t = objectTypes[res];
      if (!seq && consoleObjectTypes[res] != null) t = consoleObjectTypes[res];
      return typeof t == "function" ? t(type, info) : t;
    } else return res;
  } else {
    return resolveType(type.toString(), info);
  }
}

function isDir(target) {
  try {
    fs.readdirSync(target);
    return true;
  } catch (e) {
    //console.log(e);
    return false;
  }
}

function joinPaths(arr) {
  var p = "";
  for (var i in arr) {
    p = path.join(p, arr[i]);
  }
  return p;
}

function getIgnores(folder) {
  if (fs.existsSync(path.join(folder, ".ignore"))) {
    try {
      let data = fs.readFileSync(path.join(folder, ".ignore")).toString().replaceAll("\r", "");
      return data.split("\n");
    } catch (e) {
      console.log(".ignore error: ", { e: e, stack: e != null ? e.stack : e });
      return [];
    }
  } else {
    return [];
  }
}

function isIgnored(root, file) {
  if (root == file) return false;
  let filename = path.parse(file).base;
  let ignores = getIgnores(path.parse(file).dir);
  if (ignores.includes(filename)) return true;
  if (path.relative(root, path.parse(file).dir) == "") return false;
  return isIgnored(root, path.parse(file).dir);
}

function md5(string) {
  let hash = crypto.createHash("md5");
  hash.update(string);
  return hash.digest("hex");
}

function formatBytes(bytes) {
  if (bytes < 1000) return bytes + " B";
  else if (bytes < 1000000) return (bytes / 1000).toFixed(2) + " KB";
  else if (bytes < 1000000000) return (bytes / 1000000).toFixed(2) + " MB";
  else if (bytes < 1000000000000) return (bytes / 1000000000).toFixed(2) + " GB";
  else return (bytes / 1000000000000).toFixed(2) + " TB";
}

function readFolder(root, p = [], includeDirs = false) {
  if (p == null) p = [];
  var list = fs.readdirSync(path.join(root, joinPaths(p)));
  var files = [];
  for (i in list) {
    var target = path.join(root, joinPaths(p), list[i]);
    var targetStats = fs.statSync(target);
    if (targetStats.isDirectory() && isDir(target)) {
      if (includeDirs)
        files.push({ filename: list[i], p: p, size: null, isDir: true });
      files = files.concat(readFolder(root, p.concat([list[i]]), includeDirs));
    } else {
      var o = { filename: list[i], p: p, size: targetStats.size };
      files.push(o);
    }
  }
  return files;
}

class winstonLogger { 
  /** @type {NVLA} */
  main;

  /** @type {import('child_process').ChildProcess } */
  process;

  /** @type seqSettings */
  settings;

  stopping = false;

  promise;

  /** @type function */
  resolve;

  /** @type function */
  reject;
  
  timeout;

  errored = false;

  /** @type {import('winston').transports.StreamTransportInstance} */
  transport;

  constructor (main, settings) {
    this.main = main;
    this.settings = settings;
  }

  async log (args) {
    try {
      if (this.process != null && this.process.exitCode == null && !this.stopping) this.process.send({ type: "log", data: args });
    } catch (e) {
      this.errored = true;
      return;
    }
  }

  start () {
    if (this.process != null) return;
    this.process = fork(path.join(__dirname, "winstonLogger.js"));
    this.process.on("message", this.onMessasge.bind(this));
    this.process.on("error", this.onError.bind(this));
    this.process.on("exit", this.onExit.bind(this));
    this.promise = new Promise(this.handlePromise.bind(this));
    this.timeout = setTimeout(this.reject.bind(this, "Fork timed out"), 10000);
    this.errored = false;
    this.writableStream = new Stream.Writable();
    this.writableStream._write = (chunk, encoding, next) => next();

    this.transport = new winston.transports.Stream({
      level: "verbose",
      format: winston.format.printf(function (info) {
        if (this.config.seq.enabled) {
          processPrintF(info, true);
          info.message = info.message.replace(ansiStripRegex, "");
          if (this.alternative.process != null && !this.stopped) this.alternative.log(info);
        }
        return;
      }.bind(this.main)),
      stream: this.writableStream
    });
    this.transport
    this.main.logger.add(this.transport);
    return this.promise;
  }

  stop () {
    if (this.process == null) return;
    this.stopping = true;
    this.main.logger.remove(this.transport);
    this.transport.destroy();
    this.writableStream.destroy();
    this.process.kill();
  }

  handlePromise (resolve, reject) {
    this.resolve = resolve;
    this.reject = reject;
  }

  onMessasge (msg) {
    if (msg.type == "started") {
      this.process.send({ type: "config", settings: this.settings });
    } else if (msg.type == "ready") {
      this.main.log("Winston Logger ready", null, {color: 2});
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
    }
  }

  onError (err) {
    this.main.error("Winston Logger error: {err}", { err: err.code || err.message, stack: err.stack });
    if (this.reject != null) {
      this.reject("Winston Logger error\n", err);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
    }
  }

  onExit (code) {
    this.process = null;
    if (this.stopping) {
      this.stopping = false;
      this.main.error("Winston Logger exited with code {code}", { code: code });
      return;
    }
    if (this.reject != null) {
      this.reject("Winston Logger exited unexpectedly during start with code " + code);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
      return;
    }
    this.main.error("Winston Logger exited unexpectedly with code {code}", { code: code });
    this.start();
  }
}

class settings {
  /** @type string */
  serversFolder = path.resolve(path.join(__dirname, "servers"));

  /** @type vegaSettings */
  vega;

  /** @type seqSettings */
  seq;

  /** @type logSettings */
  logSettings;

  level = "info";

  constructor() {
    if (!fs.existsSync(path.join(__dirname, "config.json"))) fs.writeFileSync(path.join(__dirname, "config.json"), "{}");
    /** @type {import("./config.json")} */
    let obj = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json")))
    this.vega = new vegaSettings(obj.vega);
    this.logSettings = new logSettings(obj.logSettings);
    this.seq = new seqSettings(obj.seq);
    for (var i in obj) {
      if (i == "vega") continue;
      this[i] = obj[i];
    }
    try {
      this.serversFolder = path.resolve(this.serversFolder);
    } catch (e) {
      console.log("Failed to parse servers folder");
      this.serversFolder = path.resolve(path.join(__dirname, "servers"));
    }
    fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(this, null, 4));
  }
}

class logSettings {
  logfolder = "./Logs";

  /** @type string */
  maxSize = "10M";

  /** @type number */
  maxCount = 10;

  /** Tells NVLA if it should clean up common SCP SL outputs that can be ignored to save space
   *  @type boolean */
  cleanLogs = true;

  /** @type boolean */
  enabled = false;

  constructor(obj) {
    for (var i in obj) {
      this[i] = obj[i];
    }
  }
}

class seqSettings {
  /** @type string */
  host = "127.0.0.1";

  /** @type boolean */
  secure = false;

  /** @type string */
  apiKey = "secret";

  enabled = false;

  constructor(obj) {
    for (var i in obj) {
      this[i] = obj[i];
    }
  }
}

class vegaSettings {
  /** @type string */
  host = "127.0.0.1";

  /** @type number */
  port = 5555;

  /** @type string */
  password = null;

  /** @type string */
  label = "Default";

  /** @type string */
  id = null;

  constructor(obj) {
    for (var i in obj) {
      this[i] = obj[i];
    }
  }
}

class ServerConfig {
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

  /** @type number */
  maximumStartupTime = 60;

  /** @type number */
  maximumServerUnresponsiveTime = 60;

  /** @type number */
  maximumShutdownTime = 60;

  /** @type number */
  maximumRestartTime = 60;

}

class restartTime {
  /** @type number */
  hour = 0;

  /** @type number */
  minute = 0;
}

class serverState {
  updating = false;
  installing = false;
  uninstalling = false;
  restarting = false;
  configuring = false;
  starting = false;
  stopping = false;
  running = false;
  delayedRestart = false;
  delayedStop = false;
}

class Server {
  /** @type {import('child_process').ChildProcess } */
  process;

  /** @type NVLA */
  main;

  /** @type ServerConfig */
  config;

  /** @type string */
  pluginsFolderPath;

  /** @type string */
  serverConfigsFolder;

  /** @type string */
  serverCustomAssembliesFolder;

  /** @type string */
  serverInstallFolder;

  /** @type string */
  globalDedicatedServerConfigFiles;

  /** @type string */
  serverContainer;

  /** @type boolean */
  installed = false;

  /** @type boolean */
  updatePending = false;

  errorState = null;

  /** @type {import("child_process")["ChildProcess"]["prototype"]} */
  process;

  /** @type import("chokidar")["FSWatcher"]["prototype"] */
  pluginsFolderWatch;

  /** @type import("chokidar")["FSWatcher"]["prototype"] */
  configFolderWatch;

  /** boolean */
  disableWatching = false;

  ignoreConfigFilePaths = [];

  ignorePluginConfigFilePaths = [];

  /** @type serverState */
  state;

  /** @type number */
  uptime;

  /** @type Array<string> */
  players;

  /** @type NVLA["logger"] */
  logger;

  /** @type boolean */
  nvlaMonitorInstalled = false;

  /** @type import("net")["Server"]["prototype"] */
  socketServer;

  /** @type import("net")["Socket"]["prototype"] */
  socket;

  /** @type number */
  roundStartTime;

  timeout;

  /** @type string */
  lastRestart;

  /** @type number */
  memory;
  
  /** fractional cpu usage 
   * @type number */
  cpu;

  /** @type boolean */
  checkInProgress = false;

  /** @type Function */
  playerlistCallback;

  playerlistTimeout;

  monitorTimeout;

  playerlistTimeoutCount = 0;

  /** @type boolean */
  idleMode = false;

  /**
   * @param {NVLA} main
   * @param {ServerConfig} config
   */
  constructor(main, config) {
    this.main = main;
    this.logger = main.logger.child({ type: this });
    this.config = config;
    this.state = new serverState();
    this.serverContainer = path.join(path.resolve(this.main.config.serversFolder), this.config.id);
    this.serverInstallFolder = path.join(this.serverContainer, "scpsl");
    this.dedicatedServerAppdata = path.join(this.serverInstallFolder, "AppData", "SCP Secret Laboratory");
    this.pluginsFolderPath = path.join(this.dedicatedServerAppdata, "PluginAPI", "plugins", "global");
    this.serverConfigsFolder = path.join(this.serverInstallFolder, "AppData", "config", config.port.toString());
    this.globalDedicatedServerConfigFiles = path.join(this.serverInstallFolder, "AppData", "config", "global");
    this.serverCustomAssembliesFolder = path.join(this.serverInstallFolder, "SCPSL_Data", "Managed");

    try {
      if (!fs.existsSync(this.pluginsFolderPath)) fs.mkdirSync(this.pluginsFolderPath, { recursive: true });
      if (!fs.existsSync(this.serverConfigsFolder)) fs.mkdirSync(this.serverConfigsFolder, { recursive: true });
      if (!fs.existsSync(this.globalDedicatedServerConfigFiles)) fs.mkdirSync(this.globalDedicatedServerConfigFiles, { recursive: true });
      this.setupWatchers();
    } catch (e) {
      this.errorState = "Failed to create folders: " + e;
      this.error("Failed to create folders: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
  }

  log(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.verbose(arg, obj, meta);
  }

  async clearError () {
    this.errorState = null;
    this.stateUpdate();
  }

  async setupWatchers() {
    await this.stopWatchers();
    this.pluginsFolderWatch = chokidar.watch(this.pluginsFolderPath, {ignoreInitial: true,persistent: true});
    this.pluginsFolderWatch.on("all", this.onPluginConfigFileEvent.bind(this));
    this.pluginsFolderWatch.on("error", e => this.error("Plugin Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
    this.configFolderWatch = chokidar.watch(this.serverConfigsFolder, {ignoreInitial: true, persistent: true});
    this.configFolderWatch.on("all", this.onConfigFileEvent.bind(this));
    this.configFolderWatch.on("error", e => this.error("Config Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
    this.globalConfigFolderWatch = chokidar.watch(this.globalDedicatedServerConfigFiles, {ignoreInitial: true, persistent: true});
    this.globalConfigFolderWatch.on("all", this.onGlobalConfigFileEvent.bind(this));
    this.globalConfigFolderWatch.on("error", e => this.error("Global Config Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
  }

  async stopWatchers() {
    if (this.pluginsFolderWatch != null) {
      await this.pluginsFolderWatch.close();
      this.pluginsFolderWatch = null;
    }
    if (this.configFolderWatch != null) {
      await this.configFolderWatch.close();
      this.configFolderWatch = null;
    }
    if (this.globalConfigFolderWatch != null) {
      await this.globalConfigFolderWatch.close();
      this.globalConfigFolderWatch = null;
    }
  }

  async onGlobalConfigFileEvent(event, filePath) {
    if (this.disableWatching) return;
    filePath = path.relative(this.globalDedicatedServerConfigFiles, filePath);
    try {
      if (isIgnored(this.globalDedicatedServerConfigFiles, path.join(this.globalDedicatedServerConfigFiles, filePath))) return;
    } catch (e) {
      this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    if (this.ignoreConfigFilePaths.includes(filePath)) return (this.ignoreConfigFilePaths = this.ignoreConfigFilePaths.filter((x) => x != filePath));
    if (event == "add" || event == "change") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.updateFile(this.config.id, p, name, fs.readFileSync(path.join(this.globalDedicatedServerConfigFiles, filePath)).toString("base64"), "GlobalConfigFile"));
    } else if (event == "unlink") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.removeFile(this.config.id, p, name, "GlobalConfigFile"));
    }
    this.verbose("Global Config file event: {event} {filePath}", { event: event, filePath: filePath }, { color: 6 });
  }

  async onConfigFileEvent(event, filePath) {
    if (this.disableWatching) return;
    filePath = path.relative(this.serverConfigsFolder, filePath);
    try {
      if (isIgnored(this.serverConfigsFolder, path.join(this.serverConfigsFolder, filePath))) return;
    } catch (e) {
      this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    if (this.ignoreConfigFilePaths.includes(filePath)) return (this.ignoreConfigFilePaths = this.ignoreConfigFilePaths.filter((x) => x != filePath));
    if (event == "add" || event == "change") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.updateFile(this.config.id, p, name, fs.readFileSync(path.join(this.serverConfigsFolder, filePath)).toString("base64"), "ConfigFile"));
    } else if (event == "unlink") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.removeFile(this.config.id, p, name, "ConfigFile"));
    }
    this.verbose("Config file event: {event} {filePath}", { event: event, filePath: filePath }, { color: 6 });
  }

  async onPluginConfigFileEvent(event, filePath) {
    if (this.disableWatching) return;
    filePath = path.relative(this.pluginsFolderPath, filePath);
    try {
      if (isIgnored(this.pluginsFolderPath,path.join(this.pluginsFolderPath, filePath))) return;
    } catch (e) {
      this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    if (filePath.startsWith("dependencies") || filePath.endsWith(".dll")) return;
    if (this.ignorePluginConfigFilePaths.includes(filePath)) return (this.ignorePluginConfigFilePaths = this.ignorePluginConfigFilePaths.filter((x) => x != filePath));
    if (event == "add" || event == "change") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.updateFile(this.config.id, p, name, fs.readFileSync(path.join(this.pluginsFolderPath, filePath)).toString("base64"), "PluginConfigFile"));
    } else if (event == "unlink") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.removeFile(this.config.id, p, name, "PluginConfigFile"));
    }
    this.verbose("Plugin config file event: {event} {filePath}", { event: event, filePath: filePath }, { color: 6 });
  }

  async getPluginConfigFiles() {
    /** @type {File[]} */
    let files;
    try {
      files = await this.main.vega.getPluginConfiguration(this.config.id);
    } catch (e) {
      this.errorState = "Failed to get plugin configs: " + e != null ? e.code || e.message || e : e;
      return this.error("Failed to get plugin configs: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    let usedFolders = ["dependencies"];
    for (var x in files) {
      /** @type {File} */
      let file = files[x];
      let filePath = path.join(this.pluginsFolderPath, joinPaths(file.path), file.name);
      if (!usedFolders.includes(joinPaths(file.path))) usedFolders.push(joinPaths(file.path));
      this.log("Writing: {path}", { path: joinPaths(file.path) + path.sep + file.name });
      try {
        if (!fs.existsSync(path.parse(filePath).dir)) fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.errorState = "Failed to create plugin config directory: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to create plugin config directory: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
      try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, { encoding: "base64" }) == file.data) continue;
        this.ignorePluginConfigFilePaths.push(path.join(joinPaths(file.path), file.name));
        fs.writeFileSync(filePath, file.data, { encoding: "base64" });
      } catch (e) {
        this.errorState = "Failed to write plugin config file: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to write plugin config file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    /** @type Array<> */
    var currentFiles = readFolder(this.pluginsFolderPath, null, true);
    let folders = currentFiles.filter((x) => x.isDir);
    currentFiles = currentFiles.filter((x) => !x.isDir);
    for (var i in currentFiles) {
      let file = currentFiles[i];
      let safe = false;
      for (x in files) {
        let alt = files[x];
        if (path.join(joinPaths(file.p) || "./", file.filename) == path.join(joinPaths(alt.path), alt.name)) {
          safe = true;
          break;
        }
      }
      try {
        try {
          if (!isIgnored(this.pluginsFolderPath, path.join(this.pluginsFolderPath, joinPaths(file.p) || "", file.filename)) && !safe && !path.join(joinPaths(file.p) || "", file.filename).startsWith("dependencies") && !(file.filename.endsWith(".dll") && path.parse(path.join(joinPaths(file.p) || "", file.filename)).dir == "")) {
            this.log("Deleting: {path}", {path: path.join(joinPaths(file.p) || "", file.filename )});
            this.ignoreFilePaths.push(path.join(joinPaths(file.p) || "", file.filename));
            fs.rmSync(path.join(this.pluginsFolderPath, joinPaths(file.p) || "", file.filename), { recursive: true });
          }
        } catch (e) {
          this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        }
      } catch (e) {
        this.errorState = "Failed to delete unneeded plugin config file: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded plugin config file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    for (i in folders) {
      try {
        if (usedFolders.includes(path.join(path.normalize(joinPaths(folders[i].p)), folders[i].filename)) || isIgnored(this.pluginsFolderPath, path.join(this.pluginsFolderPath, joinPaths(folders[i].p) || "", folders[i].filename))) continue;
      } catch (e) {
        this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      }
      this.log("Deleting: {path}", {path: path.join(joinPaths(folders[i].p) || "", folders[i].filename)});
      try {
        fs.rmSync(path.join(this.pluginsFolderPath, joinPaths(folders[i].p) || "", folders[i].filename), { recursive: true });
      } catch (e) {
        this.errorState = "Failed to delete unneeded plugin config folder: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded plugin config folder: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    this.log("Wrote plugin configs", null, {color: 6});
  }

  async getPlugins() {
    for (var i in this.config.plugins) {
      let plugin = this.config.plugins[i];
      /** @type {File} */
      let pluginData;
      try {
        pluginData = await this.main.vega.getPlugin(plugin);
        fs.writeFileSync(path.join(this.pluginsFolderPath, plugin + ".dll"), Buffer.from(pluginData.data, "base64"));
      } catch (e) {
        this.errorState = "Failed to get plugin: '"+plugin+"'" + e != null ? e.code || e.message || e : e;
        this.error("Failed to get plugin '{plugin}': {e}", {plugin: plugin, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    let files = fs.readdirSync(this.pluginsFolderPath);
    for (var i in files) {
      let file = files[i];
      if (file.endsWith(".dll") &&!this.config.plugins.includes(file.replace(".dll", ""))) {
        this.log("Deleting: {file}", {file: file});
        try {
          fs.rmSync(path.join(this.pluginsFolderPath, file), {recursive: true});
        } catch (e) {
          this.errorState = "Failed to delete unneeded plugin: " + e != null ? e.code || e.message || e : e;
          this.error("Failed to delete unneeded plugin: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
          continue;
        }
      }
    }
    this.log("Installed plugins", null, {color: 6});
  }

  async getCustomAssemblies() {
    for (var i in this.config.customAssemblies) {
      let customAssembly = this.config.customAssemblies[i];
      /** @type {File} */
      let customAssemblyData;
      try {
        customAssemblyData = await this.main.vega.getCustomAssembly(customAssembly);
        fs.writeFileSync(path.join(this.serverCustomAssembliesFolder, customAssembly + ".dll"), Buffer.from(customAssemblyData.data, "base64"));
      } catch (e) {
        this.errorState = "Failed to get custom assembly '"+customAssembly+"': " + e != null ? e.code || e.message || e : e;
        this.error("Failed to get custom assembly '{customAssembly}': {e}", {customAssembly: customAssembly, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    this.log("Installed custom Assemblies", null, {color: 6});
  }

  async getDependencies() {
    let targetFolder = path.join(this.pluginsFolderPath, "dependencies");
    try {
      if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
    } catch (e) {
      this.errorState = "Failed to create dependencies folder: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to create dependencies folder: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    for (var i in this.config.dependencies) {
      let dependency = this.config.dependencies[i];
      /** @type {File} */
      let dependencyData;
      try {
        dependencyData = await this.main.vega.getDependency(dependency);
        fs.writeFileSync(path.join(targetFolder, dependency + ".dll"), Buffer.from(dependencyData.data, "base64"));
      } catch (e) {
        this.errorState = "Failed to get dependency '"+dependency+"': " + e != null ? e.code || e.message || e : e;
        this.error("Failed to get dependency '{dependency}': {e}", {dependency: dependency, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    this.log("Installed dependencies", null, {color: 6});
  }

  async getDedicatedServerConfigFiles() {
    /** @type {File[]} */
    let files;
    try {
      files = await this.main.vega.getDedicatedServerConfiguration(this.config.id);
    } catch (e) {
      this.errorState = "Failed to get plugin configs: " + e != null ? e.code || e.message || e : e;
      return this.error("Failed to get plugin configs: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    let usedFolders = [];
    for (var x in files) {
      /** @type {File} */
      let file = files[x];
      let filePath = path.join(this.serverConfigsFolder, joinPaths(file.path), file.name);
      if (!usedFolders.includes(joinPaths(file.path))) usedFolders.push(joinPaths(file.path));
      this.log("Writing: {path}", { path: joinPaths(file.path) + path.sep + file.name });
      try {
        if (!fs.existsSync(path.parse(filePath).dir)) fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.errorState = "Failed to create dedicated server config directory: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to create dedicated server config directory: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
      try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, { encoding: "base64" }) == file.data) continue;
        this.ignoreConfigFilePaths.push(path.join(joinPaths(file.path), file.name));
        fs.writeFileSync(filePath, file.data, { encoding: "base64" });
      } catch (e) {
        this.errorState = "Failed to create dedicated server config directory: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to write dedicated server config file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    /** @type Array<> */
    var currentFiles = readFolder(this.serverConfigsFolder, null, true);
    let folders = currentFiles.filter((x) => x.isDir);
    currentFiles = currentFiles.filter((x) => !x.isDir);
    for (var i in currentFiles) {
      let file = currentFiles[i];
      let safe = false;
      for (x in files) {
        let alt = files[x];
        if (path.join(joinPaths(file.p) || "./", file.filename) == path.join(joinPaths(alt.path), alt.name)) {
          safe = true;
          break;
        }
      }
      try {
        if (!safe) {
          this.log("Deleting: {path}", {path: path.join(joinPaths(file.p) || "", file.filename )});
          this.ignoreConfigFilePaths.push(path.join(joinPaths(file.p) || "", file.filename));
          fs.rmSync(path.join(this.serverConfigsFolder, joinPaths(file.p) || "",file.filename), { recursive: true });
        }
      } catch (e) {
        this.errorState = "Failed to delete unneeded dedicated server config file: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded dedicated server config file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    for (i in folders) {
      if (usedFolders.includes(path.join(path.normalize(joinPaths(folders[i].p)), folders[i].filename))) continue;
      this.log("Deleting: {path}", {path: path.join(joinPaths(folders[i].p) || "", folders[i].filename)});
      try {
        fs.rmSync(path.join(this.serverConfigsFolder, joinPaths(folders[i].p) || "", folders[i].filename), { recursive: true });
      } catch (e) {
        this.errorState = "Failed to delete unneeded dedicated server config folder: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded dedicated server config folder: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    this.log("Wrote dedicated server configs", null, {color: 6});
  }

  async getGlobalDedicatedServerConfigFiles() {
    /** @type {File[]} */
    let files;
    try {
      files = await this.main.vega.getGlobalDedicatedServerConfiguration(this.config.id);
    } catch (e) {
      return this.error("Failed to get global configs: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    let usedFolders = [];
    for (var x in files) {
      /** @type {File} */
      let file = files[x];
      let filePath = path.join(this.globalDedicatedServerConfigFiles, joinPaths(file.path), file.name);
      if (!usedFolders.includes(joinPaths(file.path))) usedFolders.push(joinPaths(file.path));
      this.log("Writing: {path}", { path: joinPaths(file.path) + path.sep + file.name });
      try {
        if (!fs.existsSync(path.parse(filePath).dir)) fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.errorState = "Failed to create global dedicated server config directory: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to create global dedicated server config directory: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
      try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, { encoding: "base64" }) == file.data) continue;
        this.ignoreConfigFilePaths.push(path.join(joinPaths(file.path), file.name));
        fs.writeFileSync(filePath, file.data, { encoding: "base64" });
      } catch (e) {
        this.errorState = "Failed to write global dedicated server config file: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to write global dedicated server config file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    /** @type Array<> */
    var currentFiles = readFolder(this.globalDedicatedServerConfigFiles, null, true);
    let folders = currentFiles.filter((x) => x.isDir);
    currentFiles = currentFiles.filter((x) => !x.isDir);
    for (var i in currentFiles) {
      let file = currentFiles[i];
      let safe = false;
      for (x in files) {
        let alt = files[x];
        if (path.join(joinPaths(file.p) || "./", file.filename) == path.join(joinPaths(alt.path), alt.name)) {
          safe = true;
          break;
        }
      }
      try {
        if (!safe) {
          this.log("Deleting: {path}", {path: path.join(joinPaths(file.p) || "", file.filename )});
          this.ignoreConfigFilePaths.push(path.join(joinPaths(file.p) || "", file.filename));
          fs.rmSync(path.join(this.globalDedicatedServerConfigFiles, joinPaths(file.p) || "",file.filename), { recursive: true });
        }
      } catch (e) {
        this.errorState = "Failed to delete unneeded global dedicated server config file: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded global dedicated server config file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    for (i in folders) {
      if (usedFolders.includes(path.join(path.normalize(joinPaths(folders[i].p)), folders[i].filename))) continue;
      this.log("Deleting: {path}", {path: path.join(joinPaths(folders[i].p) || "", folders[i].filename)});
      try {
        fs.rmSync(path.join(this.globalDedicatedServerConfigFiles, joinPaths(folders[i].p) || "", folders[i].filename), { recursive: true });
      } catch (e) {
        this.errorState = "Failed to delete unneeded global dedicated server config folder: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded global dedicated server config folder: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    this.log("Wrote dedicated server configs", null, {color: 6});
  }

  async configure() {
    this.state.configuring = true;
    this.stateUpdate();
    this.log("Configuring server {label}", { label: this.config.label });
    try {
      await this.getPluginConfigFiles();
    } catch (e) {
      this.errorState = "Failed to get plugin configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugin configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      return;
    }
    try {
      await this.getDependencies();
    } catch (e) {
      this.errorState = "Failed to get dependencies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dependencies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      return;
    }
    try {
      await this.getPlugins();
    } catch (e) {
      this.errorState = "Failed to get plugins: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugins: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      return;
    }
    try {
      await this.getCustomAssemblies();
    } catch (e) {
      this.errorState = "Failed to get custom assemblies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      return;
    }
    try {
      await this.getDedicatedServerConfigFiles();
    } catch (e) {
      this.errorState = "Failed to get dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      return;
    }
    try {
      await this.getGlobalDedicatedServerConfigFiles();
    } catch (e) {
      this.errorState = "Failed to get global dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get global dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      return;
    }
    if (this.config.verkey != null && this.config.verkey.trim() != "") {
      try {
        fs.writeFileSync(
          path.join(this.dedicatedServerAppdata, "verkey.txt"),
          this.config.verkey
        );
      } catch (e) {
        this.error("Failed to write verkey.txt: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      }
    } else {
      try {
        if (fs.existsSync(path.join(this.dedicatedServerAppdata, "verkey.txt")))
          fs.rmSync(path.join(this.dedicatedServerAppdata, "verkey.txt"));
      } catch (e) {
        this.errorState = "Failed to delete verkey.txt: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete verkey.txt: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      }
    }
    fs.writeFileSync(path.join(this.serverInstallFolder, "hoster_policy.txt"), "gamedir_for_configs: true");
    if (this.process != null) this.updatePending = true;
    this.state.configuring = false;
    this.stateUpdate();
    if (this.config.autoStart && this.process == null) this.start();
  }

  steamStateUpdate () {
    this.log("Test: {perc} {state}", {perc: this.main.steam.percentage, state: this.main.steam.state});
  }

  async install() {
    if (this.state.installing) return -1; // Already installing
    this.state.installing = true;
    this.stateUpdate();
    this.log("Installing server {label}", {label: this.config.label});
    try {
      this.main.steam.on("state", this.steamStateUpdate);
      this.main.steam.on("percentage", this.steamStateUpdate);
      let result = await this.main.steam.downloadApp("996560", path.normalize(this.serverInstallFolder), this.config.beta,  this.config.betaPassword, this.config.installArguments);
      this.main.steam.removeListener("state", this.steamStateUpdate);
      this.main.steam.removeListener("percentage", this.steamStateUpdate);
      if (result != 0) throw "Failed to install server";
      this.log("Installed SCPSL", null, {color: 3});
      this.installed = true;
    } catch (e) {
      this.errorState = "Failed to install server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to install server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    this.state.installing = false;
    this.stateUpdate();
    await this.configure();
  }

  async uninstall() {
    if (this.state.uninstalling) return -1; // Already uninstalling
    this.state.uninstalling = true;
    this.disableWatching = true;
    this.log("Uninstalling server {label}", {label: this.config.label});
    await this.stopWatchers();
    if (this.process != null) await this.stop(true);
    fs.rmSync(this.serverContainer, { recursive: true });
    this.state.uninstalling = false;
    this.stateUpdate();
  }

  async update() {
    if (this.state.updating) return;
    this.state.updating = true;
    this.stateUpdate();
    this.log("Updating server {label}", {label: this.config.label});
    try {
      let result = await this.main.steam.downloadApp("996560", path.normalize(this.serverInstallFolder), this.config.beta, this.config.betaPassword, this.config.installArguments);
      if (result != 0) throw "Failed to update server";
      this.log("Updated SCPSL", null, {color: 3});
      if (this.process != null) this.updatePending = true;
    } catch (e) {
      this.errorState = "Failed to update server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to update server: ", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    try {
      await this.getCustomAssemblies();
    } catch (e) {
      this.errorState = "Failed to update server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    this.state.updating = false;
    this.stateUpdate();
  }

  async updateCycle () {
    if (this.config.dailyRestarts && new Date().getHours() == this.config.restartTime.hour && new Date().getMinutes() == this.config.restartTime.minute) {
      let date = ((new Date().getMonth()) + "-" + (new Date().getDate()));
      if (this.lastRestart != date) {
        let value = await this.restart();
        if (value != null) {
          this.lastRestart = date;
          this.error("Failed to restart server, code:{e}", {e: value});
        } else {
          this.log("Scheduled Restart in progress", null, {color: 6});
          this.lastRestart = date;
          this.restart();
        }
      }
    }
    if (this.state.running && this.process != null && this.checkInProgress == false && this.nvlaMonitorInstalled == false) {
      this.checkInProgress = true;
      try {
        await this.checkServer();
      } catch (e) {
        if (e == "Timeout") {
          this.error("Failed to check server, server timed out " + this.playerlistTimeoutCount, null, {color: 4});
          this.playerlistTimeoutCount++;
          if (this.playerlistTimeoutCount >= this.config.maximumServerUnresponsiveTime/8 && !this.state.restarting) {
            this.error("Server is unresponsive, restarting", null, {color: 4});
            this.restart(true, true);
          }
        } else {
          this.error("Failed to check server, code: {e}", {e: e});
        }
      }
      this.playerlistCallback = null;
      this.playerlistTimeout = null;
      this.checkInProgress = false;
    }
  }

  /**
   * 
   * @param {nvlaMonitorUpdate} data 
   * @returns 
   */
  onMonitorUpdate (data) {
    if (this.nvlaMonitorInstalled == false) {
      this.nvlaMonitorInstalled = true;
      this.log("NVLA Monitor detected", null, {color: 3});
      if (this.playerlistTimeout != null) {
        clearTimeout(this.playerlistTimeout);
        this.playerlistTimeout = null;
      }
      if (this.playerlistCallback != null) {
        this.playerlistCallback();
        this.playerlistCallback = null;
      }
      this.checkInProgress = false;
    }
    this.players = data.players;
    clearTimeout(this.monitorTimeout);
    this.playerlistTimeoutCount = 0;
    this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.idleMode ? 60000*5 : 8000);
    return;
  }

  monitorUpdateTimeout () {
    this.error("Failed to check server, NVLA Monitor timed out " + this.playerlistTimeoutCount, null, {color: 4});
    this.playerlistTimeoutCount++;
    if (this.playerlistTimeoutCount >= this.config.maximumServerUnresponsiveTime/8 && !this.state.restarting) {
      this.error("Server is unresponsive, restarting", null, {color: 4});
      this.restart(true, true);
    } else {
      this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.idleMode ? 60000*5 : 8000);
    }
  }

  async checkServer() {
    if (this.process == null) return;
    return new Promise(function (resolve, reject) {
      this.playerlistCallback = resolve;
      this.playerlistTimeout = setTimeout(reject.bind(null, "Timeout"), 8000);
      this.command("list");
    }.bind(this));
  }

  /**
   * @returns {Promise<Net.Server>}
   */
  createSocket() {
    return new Promise(function (resolve, reject) {
        let server = new Net.Server();
        server.listen(0, function (s, resolve) { resolve(s);}.bind(this, server, resolve));
        setTimeout(function (reject) { reject("Socket took too long to open"); }.bind(null, reject),1000);
    }.bind(this));
  }

  async stateUpdate() {
    this.main.emit("serverStateChange", this);
  }

  async handleExit(code, signal) {
    this.log("Server Process Exited with {code} - {signal}", { code: code, signal: signal }, { color: 4 });
    this.socketServer.close();
    this.socketServer = null;
    this.process = null;
    this.players = null;
    this.uptime = null;
    this.nvlaMonitorInstalled = false;
    this.state.running = false;
    this.state.stopping = false;
    if (this.state.starting) {
      this.error("Server Startup failed, Exited with {code} - {signal}", { code: code, signal: signal });
      this.errorState = "Server exited during startup, Exited with "+ code +" - "+signal;
      this.state.starting = false;
    }
    this.state.delayedRestart = false;
    this.state.delayedStop = false;
    this.idleMode = false;
    this.memory = null;
    this.checkInProgress = false;
    clearTimeout(this.playerlistTimeout);
    this.cpu = null;
    this.playerlistCallback = null;
    this.playerlistTimeout = null;
    this.playerlistTimeoutCount = 0;
    this.stateUpdate();
    if (this.timeout != null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.state.restarting) {
      this.log("Server Restarting", null, { color: 2 });
      this.state.restarting = false;
      this.start();
    }
  }

  async handleError(e) {
    this.error("Error launching server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
  }

  async handleStdout(data) {
    let d = data.toString().split("\n");
    for (i in d)
      if (d[i].trim() != "") {
        var cleanup = false;
        if (d[i].indexOf("The referenced script") > -1 && d[i].indexOf("on this Behaviour") > -1 && d[i].indexOf("is missing!") > -1) cleanup = true;
        if (d[i].indexOf("Filename:  Line: ") > -1) cleanup = true;
        if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) cleanup = true;
        if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) cleanup = true;
        if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) cleanup = true;
        this.verbose(d[i], { logType: "sdtout", cleanup: cleanup }, { color: 8 });
      }
  }

  async handleStderr(data) {
    let d = data.toString().split("\n");
    for (i in d) {
      if (d[i].trim() == "") continue;
      if (d[i].indexOf("////NVLAMONITORSTATS--->") > -1) {
        let data = d[i].replace("////NVLAMONITORSTATS--->", "");
        try {
          data = JSON.parse(data);
        } catch (e) {
          this.error("Failed to parse NVLA Monitor stats: {e}", { e: e });
          return;
        }
        this.onMonitorUpdate(data);
        return;
      }
      var cleanup = false;
      if (d[i].indexOf("The referenced script") > -1 && d[i].indexOf("on this Behaviour") > -1 && d[i].indexOf("is missing!") > -1) cleanup = true;
      if (d[i].indexOf("Filename:  Line: ") > -1) cleanup = true;
      if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) cleanup = true;
      if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) cleanup = true;
      if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) cleanup = true;
      this.error(d[i], { logType: "sdtout", cleanup: cleanup }, { color: 8 });
    }
  }
  
  handleServerEvent (code) {
    if (code == 16) {
      if (this.state.starting) {
        clearTimeout(this.timeout);
        this.timeout == null;
        this.log("Started Successfully");
        this.state.starting = false;
        this.state.running = true;
        this.uptime = Date.now();
        this.stateUpdate();
        this.updateCycle();
      }
      this.roundStartTime = null;
    } else if (code == 21) {
      this.state.stopping = true;
      this.state.delayedStop = true;
      this.stateUpdate();
    } else if (code == 22) {
      this.state.restarting = true;
      this.state.delayedRestart = true;
      this.stateUpdate();
    } else if (code == 19) {
      if (this.state.delayedRestart) {
        this.state.delayedRestart = false;
        this.state.restarting = false;
      } else if (this.state.delayedStop) {
        this.state.stopping = true;
        this.state.delayedStop = false;
      }
      this.stateUpdate();
    } else if (code == 17) {
      this.idleMode = true;
      this.stateUpdate();
      if (this.nvlaMonitorInstalled) {
        clearTimeout(this.playerlistTimeout);
        this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), 60000*5);  
      }
    } else if (code == 18) {
      this.idleMode = false;
      this.stateUpdate();
      if (this.nvlaMonitorInstalled) {
        clearTimeout(this.playerlistTimeout);
        this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), 8000);  
      }
    }
  }

  handleServerMessage (chunk) {
    let data = [...chunk]
    while (data.length > 0) {
      let code = parseInt(data.shift())
      if (code >= 16) {
        // handle control code
        this.log("Event Fired: {codename}", {codename: events[code.toString()], code: code}, {color: 6});
        this.handleServerEvent(code);
      } else if (code != 0) {
        let length = (data.shift() << 24) | (data.shift() << 16) | (data.shift() << 8) | data.shift()
        let m = data.splice(0, length)
        let message = "";
        for (let i = 0; i < m.length; i++) message += String.fromCharCode(m[i])
        if (message.trim() == ("New round has been started.")) this.roundStartTime = new Date().getTime();
        if (this.playerlistCallback != null && message.indexOf("List of players") > -1) {
          var players = message.substring(message.indexOf("List of players")+17, message.indexOf("List of players")+17+message.substring(message.indexOf("List of players")+17).indexOf(")"));
          players = parseInt(players);
          if (isNaN(players)) players = 0;
          let arr = [];
          for (let i = 0; i < players; i++) arr.push("Unknown");
          this.players = arr;
          this.playerlistTimeoutCount = 0;
          clearTimeout(this.playerlistTimeout);    
          this.tempListOfPlayersCatcher = true;
          this.playerlistCallback();
          return;
        }
        if (this.tempListOfPlayersCatcher) message = message.replaceAll("\n*\n", "*");
        if (this.tempListOfPlayersCatcher && message.indexOf(":") > -1 && (message.indexOf("@") > -1 || message.indexOf("(no User ID)")) && message.indexOf("[") > -1 && message.indexOf("]") > -1 && (message.indexOf("steam") > -1 || message.indexOf("discord") > -1 || message.indexOf("(no User ID)") > -1)) return;
        else if (this.tempListOfPlayersCatcher) delete this.tempListOfPlayersCatcher;
        if (message.charAt(0) == "\n") message = message.substring(1,message.length);
        if (message.indexOf("Welcome to") > -1 && message.length > 1000) message = colors[code]("Welcome to EXILED (ASCII Cleaned to save your logs)");
        this.log(message.trim(), { logType: "console" }, { color: code });
      }
    }
  }

  handleServerConnection (socket) {
    if (socket.remoteAddress != "127.0.0.1" && socket.remoteAddress != "::ffff:127.0.0.1") return socket.end();
    if (this.socket != null) return;
    this.log("Console Socket Connected");
    this.socket = socket;
    socket.on("data", this.handleServerMessage.bind(this));
    socket.on('end', this.onSocketEnd.bind(this));
    socket.on('error', this.onSocketErr.bind(this));
  }

  onSocketEnd () {
    this.log("Console Socket Disconnected", null, {color: 4});
    this.socket = null;
  }

  onSocketErr (e) {
    try {
      this.socket.end();
    } catch (e) {}
    this.verbose("Console Socket Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}, {color: 4});
    this.socket = null;
  }

  command (command) {
    if (this.socket == null) return -1;
    command = command.trim();
    this.socket.write(Buffer.concat([toInt32(command.length), Buffer.from(command)]));
  }

  async start() {
    if (this.process != null) return -1; //Server process already active
    if (this.state.starting) return -2; //Server is already starting
    if (this.state.installing) return -3; //Server is installing
    if (this.state.updating) return -4; //Server is updating
    if (this.state.configuring) return -5; //Server is configuring
    this.log("Starting server {label}", {label: this.config.label});
    this.state.starting = true;
    this.uptime = new Date().getTime();
    this.players = null;
    this.nvlaMonitorInstalled = false;
    this.checkInProgress = false;
    this.playerlistCallback = null;
    this.playerlistTimeout = null;
    this.idleMode = false;
    this.stateUpdate();
    this.playerlistTimeoutCount = 0;
    try {
      this.socketServer = await this.createSocket();
      const address = this.socketServer.address();
      this.consolePort = address.port;
      this.socketServer.on("connection", this.handleServerConnection.bind(this));
      this.log("Console socket created on {port}", {port: this.consolePort});
    } catch (e) {
      this.error("Failed to create console socket: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return -3;
    }
    let executable = fs.existsSync(path.join(this.serverInstallFolder, "SCPSL.exe")) ? path.join(this.serverInstallFolder, "SCPSL.exe") : fs.existsSync(path.join(this.serverInstallFolder, "SCPSL.x86_64")) ? path.join(this.serverInstallFolder, "SCPSL.x86_64") : null;
    if (executable == null) {
      this.error("Failed to find executable");
      return -4;
    }
    let cwd = path.parse(executable).dir;
    let base = path.parse(executable).base;
    try {
      this.process = spawn(
        (process.platform == "win32" ? "" : "./") + base, ["-batchmode", "-nographics", "-nodedicateddelete", "-port" + this.config.port, "-console" + this.consolePort, "-id" + process.pid, "-appdatapath",
          path.relative(cwd, this.serverContainer), "-vegaId " + this.config.id,
        ], {
          cwd: cwd
        });
    } catch (e) {
      this.error("Failed to start server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return -5;
    }
    this.process.stdout.on("data", this.handleStdout.bind(this));
    this.process.stderr.on("data", this.handleStderr.bind(this));
    this.process.on("error", this.handleError.bind(this));
    this.process.on("exit", this.handleExit.bind(this));
    this.timeout = setTimeout(this.startTimeout.bind(this), 1000*this.config.maximumStartupTime);
  }

  /**
   * Ran when the server takes too long to start
   */
  async startTimeout () {
    this.error("{label} Startup took too long, restarting", {label: this.config.label});
    this.restart(true, true);
  }

  stop(forced, kill = false) {
    if (this.process == null) return -1; //Server process not active
    if (this.state.stopping) return -2; //Server already stopping
    this.state.stopping = true;
    this.stateUpdate();
    this.log((forced ? "Force " : "") + "Stopping server {label}", {label: this.config.label}, {color: 6});
    if (forced && kill) return this.process.kill();
    if (forced || this.players.length == 0) {
      this.command("stop");
      this.timeout = setTimeout(this.stopTimeout.bind(this), 1000*this.config.maximumShutdownTime);
      return;
    } else {
      if (this.state.delayedRestart) this.command("rnr");
      this.command("snr");
    }
  }

  /**
   * Ran when the server takes too long to stop
   */
  async stopTimeout () {
    this.error("{label} Shutdown took too long, forcing", {label: this.config.label});
    this.process.kill();
  }

  restart(forced, kill = false) {
    if (this.state.stopping) return -2; //Server stopping
    if (this.state.starting) return -3; //Server restarting
    if (this.state.restarting) return -4; //Server restarting
    if (this.state.uninstalling) return -5; //Server uninstalling
    if (this.process == null) return this.start();
    this.state.restarting = true;
    this.stateUpdate();
    this.log((forced ? "Force " : "") + "Restarting server {label}", {label: this.config.label}, {color: 6});
    if (forced && kill) return this.process.kill();
    if (forced || this.players.length == 0) {
      this.command("softrestart");
      this.timeout = setTimeout(this.restartTimeout.bind(this), 1000*this.config.maximumRestartTime);
      return;
    } else {
      if (this.state.delayedStop) this.command("snr");
      this.command("rnr");
    }
  }

  /**
   * Ran when the server takes too long to restart
   */
  async restartTimeout () {
    this.error("{label} Restart took too long, forcing", {label: this.config.label});
    this.process.kill();
  }

  cancelDelayedAction () {
    if (this.state.delayedRestart == false && this.state.delayedStop == false) return;
    if (this.state.delayedRestart) this.command("rnr");
    if (this.state.delayedStop) this.command("snr");
  }
}

class nvlaMonitorUpdate {
  /** @type Array<string> */
  players = [];
}

class steamLogEvent {
  /** @type String */
  runId;

  /** @type String */
  log;

  /** @type Boolean */
  isError;

  constructor(runId, log, isError) {
    this.runId = runId;
    this.log = log;
    this.isError = isError;
  }
}

class steam extends EventEmitter {
  /** @type string */
  binaryPath;

  /** @type boolean */
  found;

  /** @type boolean */
  ready;

  /** @type NVLA */
  main;

  /** @type number */
  kbytesDownloaded;

  /** @type number */
  kbytesTotal;

  /** @type number */
  percentage;

  /** @type string */
  state;

  /** @type Array<Function> */
  queue = [];

  /** @type boolean */
  inUse;

  /** @type string */
  runId;

  /** @type NVLA["logger"] */
  logger;

  /** @type {pty.IPty} */
  activeProcess;

  constructor(nvla, overridePath) {
    super();
    this.main = nvla;
    this.logger = this.main.logger.child({ type: "steam" });
    this.log("Checking steam", null, { color: 3 });
    var basePath = defaultSteamPath;
    if (overridePath) basePath = overridePath;
    if (Array.isArray(basePath)) basePath = joinPaths(basePath);
    if (process.platform === "win32") {
      this.binaryPath = path.join(basePath, "steamcmd.exe");
    } else if (process.platform === "darwin") {
      this.binaryPath = path.join(basePath, "steamcmd");
    } else if (process.platform === "linux") {
      this.binaryPath = path.join(basePath, "linux32/steamcmd");
    } else {
      throw "Unsupported platform";
    }
    if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
  }

  log(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.verbose(arg, obj, meta);
  }

  /**
   *
   * @param {String} runId
   * @param {String} str
   * @param {Boolean} isError
   */
  async onstdout(runId, str, isError) {
    this.emit("log", new steamLogEvent(runId, str, isError));
    try {
      this.verbose(`${str}`, null, { color: 6 });
      if (str[0] == "[" && str[5] == "]") {
        var percent = str.substring(1, 5).replace("%", "");
        if (percent == "----") percent = null;
        else percent = parseInt(percent);
        this.percentage = percent;
        this.state = str.substring(7, str.length);
        this.emit("percentage", percent);
        if (this.state.indexOf("(") > -1 && this.state.indexOf(")") > -1 && this.state.indexOf(" of ") > -1) this.state = this.state.replace(this.state.substring(this.state.indexOf("(") - 1,this.state.indexOf(")") + 1), "");
        this.log("Got current install state: {percentage} - {state}", { percentage: this.percentage, state: this.state }, { color: 3 });
        this.emit("state", this.state);
        if (str.indexOf("(") > -1 && str.indexOf(")") > -1 && str.indexOf(" of ") > -1) {
          let progress = str.substring(str.indexOf("(") + 1, str.indexOf(")"));
          progress = progress.replace(" KB", "").replaceAll(",", "").split(" of ");
          this.kbytesDownloaded = parseInt(progress[0]);
          this.kbytesTotal = parseInt(progress[1]);
          this.emit("progress", {downloaded: this.kbytesDownloaded, total: this.kbytesTotal});
        }
      } else if (str.startsWith(" Update state") && str.indexOf("(") > -1 && str.indexOf(")") > -1) {
        this.state = str.substring(str.indexOf(") ") + 2, str.indexOf(","));
        let alt = str.split(",")[1];
        this.percentage = parseFloat(alt.substring(alt.indexOf(": ") + 2, alt.indexOf(" (")));
        this.emit("percentage", this.percentage);
        let progress = alt.substring(alt.indexOf("(") + 1, alt.indexOf(")"));
        this.kbytesDownloaded = Math.floor(parseInt(progress.split(" / ")[0]) / 1000);
        this.kbytesTotal = Math.floor(parseInt(progress.split(" / ")[1]) / 1000);
        this.emit("progress", {downloaded: this.kbytesDownloaded, total: this.kbytesTotal});
        this.log("Got current install state: {percentage} - {state} - {downloaded}/{total}", {percentage: this.percentage, state: this.state, downloaded: this.kbytesDownloaded, total: this.kbytesTotal}, { color: 3 });
      }
    } catch (e) {
      this.error("Error in steam stdout: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
  }

  async run(params) {
    this.verbose("Steam binary path: {path}", { path: this.binaryPath }, { color: 6 });
    this.activeProcess = pty.spawn(process.platform === "win32" ? "powershell.exe" : "bash", [], {cwd: path.parse(this.binaryPath).dir, env: process.env});
    
    let proc = this.activeProcess;

    proc.write((process.platform == "darwin" ? this.binaryPath : "./"+path.parse(this.binaryPath).base) + " " + params.join(" ") + "\r");
    proc.write(process.platform === "win32" ? "exit $LASTEXITCODE\r" : "exit $?\r");

    proc.on("data", function (data) {
        let d = data.toString().split("\n");
        for (var i in d) {
          try {
            this.onstdout(this.runId, d[i], true);
          } catch (e) {
            this.error("Error in steam stdout {e}", {e: e != null ? e.code || e.message || e : e,stack: e != null ? e.stack : e});
          }
        }
    }.bind(this));

    let code = await new Promise(
      function (resolve, reject) {
        this.on("exit", resolve);
    }.bind(proc));
    this.activeProcess = null;
    this.log("Steam binary finished with code: {code}", { code: code }, { color: 3 });
    if (code == 42 || code == 7) {
      this.log("Steam binary updated, restarting", null, { color: 3 });
      return this.run(params); //If exit code is 42, steamcmd updated and triggered magic restart
    } else if (code == 0) return code;
    else {
      let error = "";
      if (code == 254) error = "Could not connect to steam for update";
      if (code == 5) error = "Login Failure";
      if (code == 8) error = "Failed to install";
      this.error("Steam execution failed: {code} {error}", {code: code,error: error});
      return code;
    }
  }

  /**
   * Runs a steamcmd command immedately or puts it in the queue
   * @param {Array<String>} params
   */
  async runWrapper(params, runId) {
    while (this.inUse)
      await new Promise(
        function (resolve, reject) {
          this.queue.push(resolve);
        }.bind(this)
      );
    this.inUse = true;
    this.runId = runId;
    let result = null;
    this.emit("starting", runId);
    this.verbose("Running: {runId}", { runId: runId }, { color: 6 });
    try {
      result = await this.run(params);
    } catch (e) {
      this.log("Steam execution caused exception: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    this.inUse = false;
    this.runId = null;
    this.emit("finished", runId);
    if (this.queue.length > 0) this.queue.shift()();
    return result;
  }

  async check() {
    this.found = false;
    this.ready = false;
    if (!fs.existsSync(this.binaryPath)) {
      let result = await this.downloadSteamBinary(this.binaryPath);
      if (fs.existsSync(this.binaryPath)) {
        this.found = true;
        this.log("Steam binary found", null, { color: 1 });
      } else {
        return result;
      }
    } else {
      this.found = true;
      this.log("Steam binary found", null, { color: 1 });
    }
    let result = await this.runWrapper(["+login anonymous", "+quit"], 0);
    if (result == 0) this.ready = true;
    return result;
  }

  async downloadApp(appId, path, beta, betaPassword, customArgs) {
    let result = await this.runWrapper(
      [
        customArgs != null ? customArgs.join(" ") : "",
        "+force_install_dir " + ('"' + path + '"'),
        "+login anonymous",
        "+app_update " + appId,
        beta != null && beta.trim() != ""
          ? "-beta " +
          beta +
          (betaPassword != null && betaPassword.trim() != ""
            ? "-betapassword " + betaPassword
            : "")
          : "",
        "validate",
        "+quit",
      ],
      Math.floor(Math.random() * 10000000000)
    );
    return result;
  }

  /**
   * Downloads and extracts the steamCMD binary for your supported platform
   */
  async downloadSteamBinary() {
    var basePath = path.parse(this.binaryPath).dir;
    if (process.platform === "linux") basePath = path.join(basePath, "../");
    this.log("Downloading steam binary", null, { color: 5 });
    let url;
    if (process.platform === "win32") {
      url = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
    } else if (process.platform === "darwin") {
      url =
        "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz";
    } else if (process.platform === "linux") {
      url =
        "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";
    } else {
      throw "Unsupported platform";
    }
    let buffer;
    this.log("Requesting file: {url}", { url: url }, { color: 5 });
    try {
      buffer = await axios({
        method: "get",
        url: url,
        responseType: "arraybuffer",
      });
      this.log("Downloaded compressed file", null, { color: 5 });
    } catch (e) {
      this.error("Failed to download steam: {e}", {
        e: e != null ? e.code || e.message || e : e,
        stack: e != null ? e.stack : e,
      });
      return -3;
    }
    this.log("Selecting decompression method", null, { color: 5 });
    if (process.platform != "win32") {
      try {
        buffer = require("zlib").gunzipSync(buffer.data);
      } catch (e) {
        this.log("Failed to decompress zip: {e}", {
          e: e != null ? e.code || e.message || e : e,
          stack: e != null ? e.stack : e,
        });
        return -1;
      }
      let tar = require("tar-fs");
      let writer = tar.extract(basePath);
      try {
        let obj = { resolve: function () { }, reject: function () { } };
        setTimeout(function () { writer.write(buffer); writer.end();}, 100);
        await new Promise(
          function (resolve, reject) {
            this.on("finish", resolve);
            this.on("error", reject);
          }.bind(writer)
        );
      } catch (e) {
        this.error("Failed extraction: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
        return -2;
      }
      this.log("Extraction complete", null, { color: 5 });
    } else {
      buffer = buffer.data;
      const AdmZip = require("adm-zip");
      try {
        this.log("Decompressing file: {path}", { path: basePath }, { color: 5 });
        let zip = new AdmZip(buffer);
        zip.extractAllTo(basePath, true, true);
        this.log("Extraction complete", null, { color: 5 });
      } catch (err) {
        this.error("Failed extraction: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
        return -2;
      }
    }
    return 1;
  }
}

class ServerManager extends EventEmitter {
  /** @type Map<String,Server> */
  servers = new Map();

  constructor() {
    super();
  }

}

class NVLA extends EventEmitter {
  /** @type steam */
  steam;

  /** @type settings */
  config;

  /** @type { import('./socket.js')["Client"]} */
  client;

  /** @type Vega */
  vega;

  /** @type ServerManager */
  ServerManager = new ServerManager();

  /** @type import("winston")["Logger"]["prototype"] */
  logger;

  /** @type number */
  cpu;

  /** @type number */
  memory;

  /** @type boolean */
  lowMemory = false;

  updateInterval;

  /** @type boolean */
  stopped = false;

  constructor() {
    super();
    this.config = new settings();

    let transports = [
      new winston.transports.Console({
        level: this.config.logSettings.level,
        format: winston.format.printf(function (info) {
          processPrintF(info);
          if (info.level == "error") info.message = chalk.red(info.message);
          return info.message;
        }.bind(this)),
      }),
    ];
    if (this.config.logSettings.enabled) {
      transports.push(
        new winston.transports.DailyRotateFile({
          frequency: "24h",
          datePattern: "YYYY-MM-DD",
          filename: path.join(
            this.config.logSettings.logfolder,
            "Main-%DATE%.log"
          ),
          maxsize: this.config.logSettings.maxSize,
          maxFiles: this.config.logSettings.maxCount,
          tailable: true,
          level: "verbose",
          format: winston.format.printf((info) => {
            processPrintF(info);
            info.message = info.message.replace(ansiStripRegex, "");
            return info.message;
          }),
        })
      );
    }

    this.logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: transports
    });

    this.alternative = new winstonLogger(this, this.config.seq);

    this.logger.exitOnError = false;

    this.updateInterval = setInterval(this.update.bind(this), 1000);
  }

  async checkMemory () {
    //If system has less than or equal to 100MB of free memory, investigate
    if (this.lowMemory == true && os.freemem() > 100000000) this.lowMemory = false;
    if (os.freemem() <= 100000000 && this.lowMemory == false) {
      this.lowMemory = true;
      var s = [];
      var SCPSLTotal = 0;
      this.ServerManager.servers.forEach((server) => {
        if (server.process != null && server.memory != null) {
          SCPSLTotal += server.memory;
          s.push({uid: server.config.id, bytes: server.memory, used: Math.round(server.memory/(os.totalmem()-os.freemem())*100)});
        }
      });
      if (s.length > 0) {
        s.sort(function (a,b){return b.bytes-a.bytes});
        this.log("Servers: {s}", {s: s});
  
        this.log("Combined Usage: {usage}%", {usage: Math.round(SCPSLTotal/(os.totalmem()-os.freemem())*100)})
  
        //If SCPSL servers are using a majority of system memory
        if (Math.round(SCPSLTotal/(os.totalmem()-os.freemem())*100) > 50) {
          this.log("!WARNING! System free memory is less than 100MB, evaluating servers memory usage", null, {color: 4});
          //if SL server is contributing a significant amount of system usage
          if (s[0].used > 50/s.length) {
            this.log("Server using a majority of overall memory will be restarted complying to silent restart restrictions to compensate", null, {color: 6});
            this.ServerManager.servers.get(s[0].uid).restart();
          } else {
            this.log("Server memory usage appears normal, please ensure your system has enough memory to support this load, tread carefully from this point.", null, {color: 3});
          }
        } else {
          this.log("!WARNING! System free memory is less than 100MB, check system memory usage", null, {color: 4});
        }
      }
    }
  }

  async update () {

    this.checkMemory();
    
    let pids = [];
    this.ServerManager.servers.forEach((server) => (server.process != null && server.process.pid != null) ? pids.push(server.process.pid) : null);
    if (pids.length > 0) {
      pidusage(pids, function (e, stats) {
        if (e) {
          this.verbose("Failed to get server process usage: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
          return;
        }
        for (i in stats) {
          let stat = stats[i];
          let server;
          this.ServerManager.servers.forEach((s) => {
            if (s.process == null || s.process.pid == null) return;
            if (s.process.pid == i) {
              server = s
              return;
            }  
          });
          if (server == null) continue;
          server.cpu = stat.cpu/(100*osAlt.cpuCount());
          server.memory = stat.memory;
        }
      }.bind(this));
    }
    
    this.ServerManager.servers.forEach(async (server) => {
      server.updateCycle();
    });
    this.cpu = await getCPUPercent();
    this.memory = Math.round((1-osAlt.freememPercentage())*100);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.steam.activeProcess != null) {
      this.steam.queue = [];
      this.steam.activeProcess.kill();
    }
    this.alternative.stop();
    clearInterval(this.updateInterval);
    this.ServerManager.servers.forEach(async (server) => server.stop(true));
  }

  async start() {
    try {
      if (this.config.seq.enabled) await this.alternative.start();
    } catch (e) {
      this.error("Failed to start winston seq: {e}", { e: e != null ? e != null ? e.code || e.message || e : e : e, stack: e != null ? e.stack : e});
    }
    this.log("Welcome to "+chalk.green("NotVeryLocalAdmin")+" v"+pack.version+" By "+chalk.cyan(pack.author)+", console is ready");
    this.stopped = false;
    var serversPath = defaultServersPath;
    if (this.config.overrideServersPath && this.config.overrideServersPath.trim() != "") basePath = overridePath;
    if (Array.isArray(serversPath)) serversPath = joinPaths(serversPath);
    if (!fs.existsSync(serversPath)) fs.mkdirSync(serversPath, { recursive: true });
    this.steam = new steam(this);
    let check = await this.steam.check();
    if (this.steam.found != true || (typeof check == "number" && check != 0) || !this.steam.ready) {
      this.error("Steam check failed: {e}", { e: check });
      process.exit();
    }
    this.log("Steam ready", null, { color: "blue" });
    this.vega = new Vega(this);
    this.vega.connect();
  }

  test () {
    this.log("Testing", {test: true}, {color: "blue"});
  }

  log(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.config.vega.id;
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.config.vega.id;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.config.vega.id;
    this.logger.verbose(arg, obj, meta);
  }
}

class File {
  /** @type {Array<string>} */
  path;

  /** @type {string} */
  name;

  /** Base64 encoded data
   * @type {string} */
  data;

  constructor(path, name, data) {
    this.path = path;
    this.name = name;
    this.data = data;
  }
}

class Vega {
  /** @type {NVLA} */
  main;

  /** @type { import('./config.json')} */
  config;

  /** @type { import('./socket.js')["Client"]} */
  client;

  /** @type {Map<string, {resolve: function, reject: function}>} */
  fileRequests = new Map();

  /** @type {messageHandler} */
  messageHandler;

  /** @type {boolean} */
  connected = false;

  /** @type NVLA["logger"] */
  logger;

  /**
   * @param {NVLA} main
   */
  constructor(main) {
    this.main = main;
    this.logger = main.logger.child({ type: this });
    this.config = main.config;
    this.messageHandler = new messageHandler(this, module.exports);
  }

  log(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    obj.machineId = this.main.config.vega.id;
    this.logger.verbose(arg, obj, meta);
  }

  async connect() {
    this.log("Connecting to Vega", null, { color: 6 });
    this.client = new Client();
    this.client.connect({
      port: this.config.vega.port,
      host: this.config.vega.host,
    });
    this.client.on("message", this.onMessage.bind(this));
    this.client.on("connect", this.onConnect.bind(this));
    this.client.on("close", this.onClose.bind(this));
    this.client.on("error", this.onError.bind(this));
    this.connected = false;
  }

  async onConnect() {
    this.client.sendMessage(new mt.auth(this.main));
  }

  serverTimeout() {
    this.log("Vega Connection timed out", null, { color: 6 });
    this.client.destroy();
  }

  async onMessage(m, s) {
    try {
      this.messageHandler.handle(m, s);
    } catch (e) {
      this.error("Failed to handle message: {e} {messageType}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e, messageType: m.type });
    }
  }

  /**
   * @returns {string}
   */
  randomFileRequestId() {
    let id = Math.random().toString(36).slice(2);
    if (this.fileRequests.has(id)) return this.randomFileRequestId();
    return id;
  }

  async onAuthenticated() {
    this.connected = true;
    try {
      //let data = await this.getFile("customAssembly", "Assembly-CSharp");
      //console.log("Got file:", data);
    } catch (e) {
      console.log("Error getting file: " + e);
    }
  }

  /**
   * @param {string} serverId
   * @returns Promise<Array<File>>
   */
  async getPluginConfiguration(serverId) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting plugin configuration: {serverId}", { serverId: serverId });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(new mt.pluginConfigurationRequest(this, { resolve: resolve, reject: reject }, serverId));
    });
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getPlugin(plugin) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting plugin: {plugin}", { plugin: plugin });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(new mt.pluginRequest(this, { resolve: resolve, reject: reject }, plugin));
    });
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getCustomAssembly(customAssembly) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting custom assembly: {customAssembly}", { customAssembly: customAssembly });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(new mt.customAssemblyRequest(this, { resolve: resolve, reject: reject }, customAssembly));
    });
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getDependency(dependency) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting dependency: {dependency}", { dependency: dependency });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(new mt.dependencyRequest(this, { resolve: resolve, reject: reject }, dependency));
    });
  }

  /**
   * @param {string} serverId
   * @returns Promise<Array<File>>
   */
  async getDedicatedServerConfiguration(serverId) {
    if (!this.connected) throw "Not connected to Vega";
    this.log.bind(this)("Requesting dedicated server configuration: {serverId}", { serverId: serverId });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(new mt.dedicatedServerConfigurationRequest(this, { resolve: resolve, reject: reject }, serverId));
    });
  }

  /**
   * @param {string} serverId
   * @returns Promise<Array<File>>
   */
  async getGlobalDedicatedServerConfiguration(serverId) {
    if (!this.connected) throw "Not connected to Vega";
    this.log.bind(this)("Requesting global dedicated server configuration: {serverId}", { serverId: serverId });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(
        new mt.globalDedicatedServerConfigurationRequest(this, { resolve: resolve, reject: reject }, serverId));
    });
  }

  async onClose() {
    this.connected = false;
    this.log("Vega Connection closed, reconnecting in 5 seconds", null, { color: 4 });
    setTimeout(this.connect.bind(this), 5000);
    if (this.client.pingSystem != null) this.client.pingSystem.destroy();
    this.fileRequests.forEach((v, k) => {
      v.reject("Vega Connection closed");
      this.fileRequests.delete(k);
    });
  }

  async onError(e) {
    this.error("Vega Connection error: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
  }
}

module.exports = {
  NVLA: NVLA,
  Vega: Vega,
  ServerConfig: ServerConfig,
  Server: Server,
  File: File,
  seqSettings: seqSettings,
  joinPaths: joinPaths,
};
