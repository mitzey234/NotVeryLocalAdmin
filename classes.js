const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn, fork, exec } = require("child_process");
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
const udp = require('dgram');
const exp = require("constants");

function getCPUPercent () {
    return new Promise((resolve, reject) => {
        osAlt.cpuUsage(function(resolve, reject, v){
            resolve(Math.round(v*100));
        }.bind(null,resolve, reject));
    });
}

var defaultSteamPath = [__dirname, "steam"];
var defaultServersPath = [__dirname, "servers"];
var verkeyPath;

let availableCpus = os.cpus().length;

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
  const str = (date ? `${d.getMonth() + 1}/${d.getDate()} ` : "") + `${d.toTimeString().slice(0, 8)}.${d.getMilliseconds().toString().padStart(3, "0")}`;
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

function convertToMask (cpus) {
  if (typeof cpus == "object" && Array.isArray(cpus)) {
      let sum = 0;
      for (i in cpus) sum += Math.pow(2,cpus[i]);
      return sum.toString(16);
  } else if (typeof cpus == "number") {
      return Math.pow(2,cpus).toString(16);
  } else {
      throw "Unsupported type:" + typeof cpus;
  }
}

function runCommand (command) {
  return new Promise(function (resolve, reject) {
      let run = exec(command);
      run.on("close", resolve);
  }.bind(command));
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

function joinPaths (arr) {
  var p = '';
  if (arr.length == 1 && arr[0].trim() == "") return "";
  for (let i in arr) p = path.join(p, arr[i]);
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

function loadMD5 (p) {
  return new Promise(function (resolve, reject) {
      let hash = crypto.createHash('md5');
      let stream;
      try {
          stream = fs.createReadStream(this.toString());
      } catch (e) {
          reject(e);
      }
      stream.on('data', function (data) {
          hash.update(data, 'utf8')
      });
      stream.on('end', function () {
          resolve(hash.digest('base64'));
      });
      stream.on('error', function (e) {
          reject(e);
      });
  }.bind(p))
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
    if (this.errored) return;
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
    this.writableStream = new Stream.Writable(); //null pipe
    this.writableStream._write = (chunk, encoding, next) => next(); //null pipe

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
      this.main.logger.add(this.transport);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
    }
  }

  onError (err) {
    this.errored = true;
    if (this.process.killed) this.process = null;
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

  /** @type number */
  echoServerPort = 5050;

  /** @type string */
  echoServerAddress = "0.0.0.0";

  level = "info";

  verkey = null;

  cpuBalance = true;

  cpusPerServer = 2;

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
    verkeyPath = process.platform == "win32" ? path.join(process.env.APPDATA, "SCP Secret Laboratory", "verkey.txt") : path.join(process.env.HOME, ".config", "SCP Secret Laboratory", "verkey.txt");
    if (this.verkey == null) {
      if (fs.existsSync(verkeyPath)) this.verkey = fs.readFileSync(verkeyPath).toString();
      if (this.verkey != null && this.verkey.trim() == "") this.verkey = null;
    } else if (this.verkey.trim() != "") {
      try {
        if (!fs.existsSync(path.parse(verkeyPath).dir)) fs.mkdirSync(path.parse(verkeyPath).dir, { recursive: true });
        fs.writeFileSync(verkeyPath, this.verkey);
      } catch (e) {
        console.error("Failed to write verkey to file");
      }
    } else {
      this.verkey = null;
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

  cleanLogs = true;

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
  idleMode = false;
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

  pluginLockfiles = new Map();

  configLockfiles = new Map();

  globalConfigLockfiles = new Map();

  /** @type serverState */
  state;

  /** @type number */
  uptime;

  /** @type Array<string> */
  players;

  /** @type number */
  tps;

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

  /** @type number */
  percent;

  /** @type string */
  steamState;

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
    this.log("Server local config folder: " + this.serverContainer);
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

  async resetPluginConfigWatcher () {
    if (this.pluginsFolderWatch != null) {
      await this.pluginsFolderWatch.close();
      this.pluginsFolderWatch = null;
    }
    this.pluginsFolderWatch = chokidar.watch(this.pluginsFolderPath, {ignoreInitial: true,persistent: true});
    this.pluginsFolderWatch.on("all", this.onPluginConfigFileEvent.bind(this));
    this.pluginsFolderWatch.on("error", e => this.error("Plugin Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
  }

  async resetServerConfigWatcher () {
    if (this.configFolderWatch != null) {
      await this.configFolderWatch.close();
      this.configFolderWatch = null;
    }
    this.configFolderWatch = chokidar.watch(this.serverConfigsFolder, {ignoreInitial: true, persistent: true});
    this.configFolderWatch.on("all", this.onConfigFileEvent.bind(this));
    this.configFolderWatch.on("error", e => this.error("Config Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
  }

  async resetGlobalServerConfigWatcher () {
    if (this.globalConfigFolderWatch != null) {
      await this.globalConfigFolderWatch.close();
      this.globalConfigFolderWatch = null;
    }
    this.globalConfigFolderWatch = chokidar.watch(this.globalDedicatedServerConfigFiles, {ignoreInitial: true, persistent: true});
    this.globalConfigFolderWatch.on("all", this.onGlobalConfigFileEvent.bind(this));
    this.globalConfigFolderWatch.on("error", e => this.error("Global Config Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
  }



  async onGlobalConfigFileEvent(event, filePath) {
    this.configFileEvent("globalServerConfig", event, filePath);
  }

  async onConfigFileEvent(event, filePath) {
    this.configFileEvent("serverConfig", event, filePath);
  }

  async onPluginConfigFileEvent(event, filePath) {
    this.configFileEvent("pluginConfig", event, filePath);
  }

  /** @type Map<string,{type: string, event: string, filePath: string}> */
  fileEventQueue = new Map();

  async processFileEventQueue () {
    if (this.state.starting) return;
    if (this.fileEventQueue.size == 0) return;
    for (let i of this.fileEventQueue.entries()) {
      let key = i[0];
      let data = i[1];
      await this.configFileEvent(data.type, data.event, data.filePath);
      this.fileEventQueue.delete(key);
    }
    if (this.fileEventQueue.size > 0) setTimeout(this.processFileEventQueue.bind(this), 1000);
  }

  async configFileEvent (type, event, filePath) {
    if (this.state.starting) {
      let id = crypto.createHash('sha256').update(type+filePath).digest('hex');
      if (this.fileEventQueue.has(id)) return;
      this.fileEventQueue.set(id, {type: type, event: event, filePath: filePath});
      setTimeout(this.processFileEventQueue.bind(this), 1000);
      return;
    }
    if (this.disableWatching) return;
    let targetFolder;
    let lockfiles;
    if (type == "pluginConfig") {
      if (filePath.startsWith("dependencies") || filePath.endsWith(".dll")) return;
      targetFolder = this.pluginsFolderPath;
      lockfiles = this.pluginLockfiles;
    } else if (type == "serverConfig") {
      targetFolder = this.serverConfigsFolder;
      lockfiles = this.configLockfiles;
    } else if (type == "globalServerConfig") {
      targetFolder = this.globalDedicatedServerConfigFiles;
      lockfiles = this.globalConfigLockfiles;
    }
    filePath = path.relative(targetFolder, filePath);
    try {
      if (isIgnored(targetFolder,path.join(targetFolder, filePath))) return;
    } catch (e) {
      this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    if (filePath.startsWith("dependencies") || filePath.endsWith(".dll")) return;
    if (lockfiles.has(filePath)) return;
    if (event == "add" || event == "change") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.updateFile(this.config.id, p, name, fs.readFileSync(path.join(targetFolder, filePath)).toString("base64"), type));
    } else if (event == "unlink") {
      let p = path.parse(path.normalize(filePath)).dir.split(path.sep);
      let name = path.parse(filePath).base;
      this.main.vega.client.sendMessage(new mt.removeFile(this.config.id, p, name, type));
    }
    this.log(type+" file event: {event} {filePath}", { event: event, filePath: filePath }, { color: 6 });
  }

  async getConfigs (type) {
    let targetFolder;
    let names;
    let shortName;
    let usedFolders = [];
    let lockFiles;
    if (type == "pluginConfig") {
      targetFolder = this.pluginsFolderPath;
      names = "Plugin Configs";
      shortName = "Plugin Config";
      usedFolders.push("dependencies");
      lockFiles = this.pluginLockfiles;
    } else if (type == "serverConfig") {
      targetFolder = this.serverConfigsFolder;
      names = "Server Configs";
      shortName = "Server Config";
      lockFiles = this.configLockfiles;
    } else if (type == "globalServerConfig") {
      targetFolder = this.globalDedicatedServerConfigFiles;
      names = "Global Server Configs";
      shortName = "Global Server Config";
      lockFiles = this.globalConfigLockfiles;
    } else {
      throw "Invalid type";
    }
    if (targetFolder == null) throw "Target folder was null";
    let files;
    try {
      files = await this.main.vega.getConfigs(type, this.config.id);
    } catch (e) {
      this.errorState = "Failed to get "+names+": " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get {subType}: {e}", {subType: names, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    for (var x in files) {
      /** @type {File} */
      let file = files[x];
      let filePath = path.join(targetFolder, joinPaths(file.path), file.name);
      if (!usedFolders.includes(joinPaths(file.path))) usedFolders.push(joinPaths(file.path));
      try {
        if (!fs.existsSync(path.parse(filePath).dir)) fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.errorState = "Failed to create "+shortName+" directory: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to create "+shortName+" directory: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
      try {
        if (fs.existsSync(filePath) && await loadMD5(filePath) == file.md5) {
          this.log("Up to date: {path}", { path: joinPaths(file.path) + path.sep + file.name });
          continue;
        }
        if (this.state.running) this.updatePending = true;
        this.log("Writing ("+file.md5+"): {path}", { path: joinPaths(file.path) + path.sep + file.name });
        if (!lockFiles.has(path.join(joinPaths(file.path), file.name))) lockFiles.set(path.join(joinPaths(file.path), file.name), 0);
        let lockfile = lockFiles.get(path.join(joinPaths(file.path), file.name))+1;
        lockFiles.set(path.join(joinPaths(file.path), file.name), lockfile);
        await this.main.vega.downloadFile("configFile", type, file.name, this, file.path);
        let localmd5 = await loadMD5(filePath);
        if (localmd5 != file.md5) throw "MD5 mismatch: " + localmd5;
      } catch (e) {
        this.errorState = "Failed to write "+shortName+" file ("+file.name+"): " + e != null ? e.code || e.message || e : e;
        this.error("Failed to write "+shortName+" file ({name}): {e}\n{stack}", {name: file.name, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      }
    }
    /** @type Array<> */
    var currentFiles = readFolder(targetFolder, null, true);
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
          if (!isIgnored(targetFolder, path.join(targetFolder, joinPaths(file.p) || "", file.filename)) && !safe && (type == "pluginConfig" ? !path.join(joinPaths(file.p) || "", file.filename).startsWith("dependencies") : true) && !(file.filename.endsWith(".dll") && path.parse(path.join(joinPaths(file.p) || "", file.filename)).dir == "")) {
            this.log("Deleting: {path}", {path: path.join(joinPaths(file.p) || "", file.filename )});
            if (!lockFiles.has(path.join(joinPaths(file.p) || "", file.filename))) lockFiles.set(path.join( joinPaths(file.p) || "", file.filename), 0);
            let lockfile = lockFiles.get(path.join(joinPaths(file.p) || "", file.filename))+1;
            lockFiles.set(path.join(joinPaths(file.p) || "", file.filename), lockfile);
            fs.rmSync(path.join(targetFolder, joinPaths(file.p) || "", file.filename), { recursive: true });
            if (this.state.running) this.updatePending = true;
          }
        } catch (e) {
          this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        }
      } catch (e) {
        this.errorState = "Failed to delete unneeded "+shortName+" file: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded "+shortName+" file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    let filtered = [];
    for (i in usedFolders) {
      var p = usedFolders[i];
      while (p != "") {
        if (p.trim() != "" && !filtered.includes(p)) filtered.push(p);
        p = path.parse(p).dir;
      }
    }
    usedFolders = filtered;
    for (i in folders) {
      try {
        if (isIgnored(targetFolder, path.join(targetFolder, joinPaths(folders[i].p) || "", folders[i].filename))) continue;
      } catch (e) {
        this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      }
      if (usedFolders.includes(path.join(path.normalize(joinPaths(folders[i].p)), folders[i].filename))) continue;
      this.log("Deleting: {path}", {path: path.join(joinPaths(folders[i].p) || "", folders[i].filename)});
      try {
        fs.rmSync(path.join(targetFolder, joinPaths(folders[i].p) || "", folders[i].filename), { recursive: true });
        if (this.state.running) this.updatePending = true;
      } catch (e) {
        this.errorState = "Failed to delete unneeded "+shortName+" folder: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded "+shortName+" folder: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    this.log("Wrote "+names+"", null, {color: 6});
  }

  getConfigInProgress = false;

  /**
   * @param {string} type 
   * @param {FileInfo} file 
   * @returns 
   */
  async getConfig (type, file) {
    while (this.getConfigInProgress) await new Promise((resolve) => setTimeout(resolve, 200));
    this.getConfigInProgress = true;
    let targetFolder;
    let names;
    let shortName;
    let usedFolders = [];
    let lockFiles;
    try {
      if (type == "pluginConfig") {
        targetFolder = this.pluginsFolderPath;
        names = "Plugin Configs";
        shortName = "Plugin Config";
        usedFolders.push("dependencies");
        lockFiles = this.pluginLockfiles;
      } else if (type == "serverConfig") {
        targetFolder = this.serverConfigsFolder;
        names = "Server Configs";
        shortName = "Server Config";
        lockFiles = this.configLockfiles;
      } else if (type == "globalServerConfig") {
        targetFolder = this.globalDedicatedServerConfigFiles;
        names = "Global Server Configs";
        shortName = "Global Server Config";
        lockFiles = this.globalConfigLockfiles;
      } else {
        throw "Invalid type";
      }
    } catch (e) {
      this.getConfigInProgress = false;
      return;
    }
    let filePath = path.join(targetFolder, joinPaths(file.path), file.name);
    if (!usedFolders.includes(joinPaths(file.path))) usedFolders.push(joinPaths(file.path));
    try {
      if (!fs.existsSync(path.parse(filePath).dir)) fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
    } catch (e) {
      this.errorState = "Failed to create "+shortName+" directory: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to create "+shortName+" directory: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.getConfigInProgress = false;
      return;
    }
    try {
      if (fs.existsSync(filePath) && await loadMD5(filePath) == file.md5) {
        this.log("Up to date: {path}", { path: joinPaths(file.path) + path.sep + file.name });
        this.getConfigInProgress = false;
        return;
      }
      if (this.state.running) this.updatePending = true;
      this.log("Writing ("+file.md5+"): {path}", { path: joinPaths(file.path) + path.sep + file.name });
      if (!lockFiles.has(path.join(joinPaths(file.path), file.name))) lockFiles.set(path.join(joinPaths(file.path), file.name), 0);
      let lockfile = lockFiles.get(path.join(joinPaths(file.path), file.name))+1;
      lockFiles.set(path.join(joinPaths(file.path), file.name), lockfile);
      await this.main.vega.downloadFile("configFile", type, file.name, this, file.path);
      if (await loadMD5(filePath) != file.md5) {
        await this.getConfig(type, file);
        throw "MD5 mismatch";
      }
      lockfile = lockFiles.get(path.join(joinPaths(file.path), file.name))-1;
      if (lockfile <= 0) lockFiles.delete(path.join(joinPaths(file.path), file.name));
      else lockFiles.set(path.join(joinPaths(file.path), file.name), lockfile);
    } catch (e) {
      this.errorState = "Failed to write "+shortName+" file ("+file.name+"): " + e != null ? e.code || e.message || e : e;
      this.error("Failed to write "+shortName+" file ({name}): {e}\n{stack}", {name: file.name, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    this.getConfigInProgress = false;
  }


  getPluginConfigFilesInProg = false;
  getDedicatedServerConfigFilesInProg = false;
  getGlobalDedicatedServerConfigFilesInProg = false;

  async getPluginConfigFiles() {
    if (this.getPluginConfigFilesInProg) while (this.getPluginConfigFilesInProg) await new Promise((resolve, reject) => setTimeout(resolve, 100));
    this.getPluginConfigFilesInProg = true;
    try {
      await this.getConfigs.bind(this)("pluginConfig");
      await this.resetPluginConfigWatcher();
      this.pluginLockfiles.clear();
    } catch (e) {
      this.errorState = "Failed to get plugin configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugin configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getPluginConfigFilesInProg = false;
  }

  async getDedicatedServerConfigFiles() {
    if (this.getDedicatedServerConfigFilesInProg) while (this.getDedicatedServerConfigFilesInProg) await new Promise((resolve, reject) => setTimeout(resolve, 100));
    this.getDedicatedServerConfigFilesInProg = true;
    try {
      await this.getConfigs.bind(this)("serverConfig");
      await this.resetServerConfigWatcher();
      this.configLockfiles.clear();
    } catch (e) {
      this.errorState = "Failed to get dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getDedicatedServerConfigFilesInProg = false;
  }

  async getGlobalDedicatedServerConfigFiles() {
    if (this.getGlobalDedicatedServerConfigFilesInProg) while (this.getGlobalDedicatedServerConfigFilesInProg) await new Promise((resolve, reject) => setTimeout(resolve, 100));
    this.getGlobalDedicatedServerConfigFilesInProg = true;
    try {
      await this.getConfigs.bind(this)("globalServerConfig");
      await this.resetGlobalServerConfigWatcher();
      this.globalConfigLockfiles.clear();
    } catch (e) {
      this.errorState = "Failed to get global dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get global dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getGlobalDedicatedServerConfigFilesInProg = false;
  }

  async grabAssemblies (type) {
    let data;
    let targetFolder
    let names;
    let shortName;
    let property;
    let ignoreExisting = false;
    if (type == "dependency") {
      targetFolder = path.join(this.pluginsFolderPath, "dependencies");
      property = "dependencies";
      names = "Dependencies";
      shortName = "Dependency";
    } else if (type == "plugin") {
      targetFolder = this.pluginsFolderPath;
      names = "Plugins";
      property = "plugins";
      shortName = "Plugin";
    } else if (type == "customAssembly") {
      targetFolder = this.serverCustomAssembliesFolder;
      names = "Custom Assemblies";
      property = "customAssemblies";
      shortName = "Custom Assembly";
      ignoreExisting = true;
    }
    try {
      data = await this.main.vega.getAssemblies(type, this.config.id);
    } catch (e) {
      this.errorState = "Failed to get "+names+": " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get {subType}: {e}", {subType: names, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    /** @type Map<string, import("./classes")["FileInfo"]["prototype"]> */
    let expected = new Map();
    for (i in data) {
      let assembly = data[i];
      expected.set(assembly.name, assembly);
    }
    let found = [];
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, {recursive: true});
    let files = fs.readdirSync(targetFolder);
    for (let i in files) {
      let file = files[i];
      let stats = fs.statSync(path.join(targetFolder, file));
      if (!stats.isFile()) continue;
      let name = file.replace(".dll", "");
      if (file.endsWith(".dll") && !expected.has(name) && !ignoreExisting) {
        this.log("Deleting: {file}", {file: file});
        try {
          fs.rmSync(path.join(targetFolder, file), {recursive: true});
          if (this.state.running) this.updatePending = true;
        } catch (e) {
          this.errorState = "Failed to delete unneeded "+shortName+": " + e != null ? e.code || e.message || e : e;
          this.error("Failed to delete unneeded "+shortName+": {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
          continue;
        }
      } else if (file.endsWith(".dll") && expected.has(name)) {
        let md5;
        try {
          md5 = await loadMD5(path.join(targetFolder, file));
        } catch (e) {
          this.errorState = "Failed to get "+shortName+" MD5: " + e != null ? e.code || e.message || e : e;
          this.error("Failed to get "+shortName+" MD5: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e, path: path.join(targetFolder, file)});
          continue;
        }
        if (expected.get(name).md5 == md5) found.push(name);
      }
    }
    for (let i in data) {
      let assembly = data[i];
      if (!found.includes(assembly.name)) {
        this.log("Updating: {assName}", {assName: assembly.name, subtype: type});
        try {
          await this.main.vega.downloadFile("assemblies", type, assembly.name, this, null);
          if (this.state.running) this.updatePending = true;
        } catch (e) {
          this.errorState = "Failed to download "+shortName+" '"+assembly.name+"': " + e != null ? e.code || e.message || e : e;
          this.error("Failed to download "+shortName+" '{name}': {e}", {name: assembly.name, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
          continue;
        }
      } else {
        this.log(shortName+" up to date: {name}", {name: assembly.name, subtype: type});
      }
    }
    this.log("Installed "+names, null, {color: 6});
  }

  getPluginsInProg = false;
  getCustomAssembliesInProg = false;
  getDependenciesInProg = false;

  async getPlugins() {
    if (this.getPluginsInProg) while (this.getPluginsInProg) await new Promise((resolve, reject) => setTimeout(resolve, 100));
    this.getPluginsInProg = true;
    try {
      await this.grabAssemblies.bind(this)("plugin");
    } catch (e) {
      this.errorState = "Failed to get plugins: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugins: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getPluginsInProg = false;
  }

  async getCustomAssemblies() {
    if (this.getCustomAssembliesInProg) while (this.getCustomAssembliesInProg) await new Promise((resolve, reject) => setTimeout(resolve, 100));
    this.getCustomAssembliesInProg = true;
    try {
      await this.grabAssemblies.bind(this)("customAssembly");
    } catch (e) {
      this.errorState = "Failed to get custom assemblies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getCustomAssembliesInProg = false;
  }

  async getDependencies() {
    if (this.getDependenciesInProg) while (this.getDependenciesInProg) await new Promise((resolve, reject) => setTimeout(resolve, 100));
    this.getDependenciesInProg = true;
    try {
      await this.grabAssemblies.bind(this)("dependency");
    } catch (e) {
      this.errorState = "Failed to get dependencies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dependencies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getDependenciesInProg = false;
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
      this.state.configuring = false;
      this.stateUpdate();
      return;
    }
    try {
      await this.getDependencies();
    } catch (e) {
      this.errorState = "Failed to get dependencies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dependencies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      this.stateUpdate();
      return;
    }
    try {
      await this.getPlugins();
    } catch (e) {
      this.errorState = "Failed to get plugins: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugins: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      this.stateUpdate();
      return;
    }
    try {
      await this.getCustomAssemblies();
    } catch (e) {
      this.errorState = "Failed to get custom assemblies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      this.stateUpdate();
      return;
    }
    try {
      await this.getDedicatedServerConfigFiles();
    } catch (e) {
      this.errorState = "Failed to get dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      this.stateUpdate();
      return;
    }
    try {
      await this.getGlobalDedicatedServerConfigFiles();
    } catch (e) {
      this.errorState = "Failed to get global dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get global dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      this.stateUpdate();
      return;
    }
    fs.writeFileSync(path.join(this.serverInstallFolder, "hoster_policy.txt"), "gamedir_for_configs: true");
    this.state.configuring = false;
    this.stateUpdate();
    if (this.config.autoStart && this.process == null) this.start();
  }

  steamStateUpdate () {
    this.percent = this.main.steam.percentage;
    this.steamState = this.main.steam.state;
    this.stateUpdate();
  }

  async install() {
    if (this.state.installing) return -1; // Already installing
    this.state.installing = true;
    this.stateUpdate();
    this.log("Installing server {label}", {label: this.config.label});
    try {
      let result = await this.main.steam.downloadApp("996560", path.normalize(this.serverInstallFolder), this.config.beta,  this.config.betaPassword, this.config.installArguments, this);
      this.percent = null;
      this.steamState = null;
      if (result == -1) {
        this.state.installing = false;
        this.stateUpdate();
        return;
      }
      if (result != 0) throw "Steam exit code invalid: " + result;
      this.log("Installed SCPSL", null, {color: 3});
      this.installed = true;
    } catch (e) {
      this.errorState = "Failed to install server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to install server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.state.installing = false;
      this.stateUpdate();
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
    if (this.process != null) {
      await new Promise(async function (resolve) {
        while (this.process != null) await new Promise(r => setTimeout(r, 200));
        resolve();
      }.bind(this));
      this.stop(true);
    }
    fs.rmSync(this.serverContainer, { recursive: true });
    this.state.uninstalling = false;
    this.stateUpdate();
  }

  async update(skipConfig) {
    if (this.state.updating) return;
    this.errorState = null;
    this.state.updating = true;
    this.stateUpdate();
    this.log("Updating server {label}", {label: this.config.label});
    try {
      let result = await this.main.steam.downloadApp("996560", path.normalize(this.serverInstallFolder), this.config.beta, this.config.betaPassword, this.config.installArguments, this);
      this.percent = null;
      this.steamState = null;
      if (result == -1) {
        this.state.updating = false;
        this.stateUpdate();
        return;
      }
      if (result != 0) throw "Steam exit code invalid: " + result;
      this.log("Updated SCPSL", null, {color: 3});
      if (this.process != null) this.updatePending = true;
    } catch (e) {
      this.errorState = "Failed to update server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to update server: ", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.state.updating = false;
      this.stateUpdate();
      return;
    }
    try {
      if (!skipConfig) await this.configure();
    } catch (e) {
      this.errorState = "Failed to update server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.state.updating = false;
      this.stateUpdate();
      return;
    }
    this.state.updating = false;
    this.stateUpdate();
  }

  async updateCycle () {
    this.main.vega.serverStateChange(this);
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
          if (this.playerlistTimeoutCount >= this.config.maximumServerUnresponsiveTime/8) {
            this.error("Server is unresponsive, restarting", null, {color: 4});
            this.state.restarting = true;
            this.process.kill(9);
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
    if (!this.state.running) return;
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
    this.tps = data.tps;
    if (this.state.idleMode) this,this.tps = null;
    clearTimeout(this.monitorTimeout);
    this.playerlistTimeoutCount = 0;
    this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.state.idleMode ? 60000*5 : 8000);
    return;
  }

  monitorUpdateTimeout () {
    if (!this.state.running) return;
    this.error("Failed to check server, NVLA Monitor timed out " + this.playerlistTimeoutCount, null, {color: 4});
    this.playerlistTimeoutCount++;
    if (this.playerlistTimeoutCount >= this.config.maximumServerUnresponsiveTime/8) {
      this.error("Server is unresponsive, restarting", null, {color: 4});
      this.state.restarting = true;
      this.process.kill(9);
    } else {
      clearTimeout(this.monitorTimeout);
      this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.state.idleMode ? 60000*5 : 8000);
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
    this.processFileEventQueue();
  }

  async handleExit(code, signal) {
    this.log("Server Process Exited with {code} - {signal}", { code: code, signal: signal }, { color: 4 });
    try {
      this.socketServer.close();
    } catch (e) {}
    this.socketServer = null;
    if (this.monitorTimeout != null) {
      clearTimeout(this.monitorTimeout);
      this.monitorTimeout = null;
    }
    if (this.playerlistTimeout != null) {
      clearTimeout(this.playerlistTimeout);
      this.playerlistTimeout = null;
    }
    this.process = null;
    this.players = null;
    this.tps = null;
    this.uptime = null;
    this.nvlaMonitorInstalled = false;
    this.state.running = false;
    this.state.delayedRestart = false;
    this.updatePending = false;
    this.state.delayedStop = false;
    this.state.idleMode = false;
    this.memory = null;
    this.checkInProgress = false;
    clearTimeout(this.playerlistTimeout);
    this.cpu = null;
    this.playerlistCallback = null;
    this.playerlistTimeout = null;
    this.playerlistTimeoutCount = 0;
    if (this.timeout != null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.state.stopping) {
      this.state.stopping = false;
      this.state.restarting = false;
      this.state.starting = false;
      this.stateUpdate();
      return;
    }
    if (this.state.restarting) {
      this.log("Server Restarting", null, { color: 2 });
      this.state.restarting = false;
      this.state.starting = false;
      this.start();
      this.stateUpdate();
      return;
    }
    if (this.state.starting) {
      this.error("Server Startup failed, Exited with {code} - {signal}", { code: code, signal: signal });
      this.errorState = "Server exited during startup, Exited with "+ code +" - "+signal;
      this.state.starting = false;
      this.stateUpdate();
      return;
    }
    this.error("Unexpected server death, Exited with {code} - {signal}", { code: code, signal: signal });
    this.start();
    this.stateUpdate();
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
        else if (d[i].indexOf("Filename:  Line: ") > -1) cleanup = true;
        else if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) cleanup = true;
        else if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) cleanup = true;
        else if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) cleanup = true;
        if (cleanup == true && this.config.cleanLogs) continue;
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
      this.error(d[i], { logType: "sdtout", cleanup: false }, { color: 8 });
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
        this.main.emit("serverReady", this);
        this.updateCycle();
      }
      this.roundStartTime = null;
    } else if (code == 21 || code == 20) {
      if (this.state.delayedRestart) this.state.delayedRestart = false;
      if (this.state.stopping && this.state.delayedStop) {
        this.state.delayedStop = false;
      }
      else if (this.state.stopping && !this.state.delayedStop) {
        this.state.delayedStop = false;
      }
      else {
        this.state.stopping = true;
        this.state.delayedStop = true;
      }
      this.stateUpdate();
    } else if (code == 22) {
      if (this.state.delayedStop) this.state.delayedStop = false;
      if (this.state.restarting && this.state.delayedRestart) {
        this.state.delayedRestart = false;
      }
      else if (this.state.restarting && !this.state.delayedRestart) {
        this.state.delayedRestart = false;
      }
      else {
        this.state.restarting = true;
        this.state.delayedRestart = true;
      }
      this.stateUpdate();
    } else if (code == 19) {
      if (this.state.delayedRestart) {
        this.state.delayedRestart = false;
        this.state.restarting = false;
      } else if (this.state.delayedStop) {
        this.state.stopping = false;
        this.state.delayedStop = false;
      }
      this.stateUpdate();
    } else if (code == 17) {
      this.state.idleMode = true;
      this.players = [];
      this.tps = 0;
      this.stateUpdate();
      if (this.nvlaMonitorInstalled) {
        clearTimeout(this.monitorTimeout);
        this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), 60000*5);  
      }
    } else if (code == 18) {
      this.state.idleMode = false;
      this.stateUpdate();
      if (this.nvlaMonitorInstalled) {
        clearTimeout(this.monitorTimeout);
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
        if (events[code.toString()] != null) this.log("Event Fired: {codename}", {codename: events[code.toString()], code: code}, {color: 6});
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
          this.tps = 0;
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
        this.main.vega.client.sendMessage(new mt.serverConsoleLog(this.config.id, message.replace(ansiStripRegex, "").trim(), code));
        this.log(message.trim(), { logType: "console" }, { color: code });
      }
    }
  }

  handleServerConnection (socket) {
    if (socket.remoteAddress != "127.0.0.1" && socket.remoteAddress != "::ffff:127.0.0.1") {
      try {
        socket.end();
      } catch (e) {}
      return;
    }
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
    if (this.main.vega.connected) this.main.vega.client.sendMessage(new mt.serverConsoleLog(this.config.id, "> "+command, 3));
    try {
      this.socket.write(Buffer.concat([toInt32(command.length), Buffer.from(command)]));
    } catch (e) {
      this.error("Console Socket Write Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}, {color: 4});
      return -2;
    }
  }

  async start() {
    if (this.process != null) return -1; //Server process already active
    if (this.state.starting) return -2; //Server is already starting
    if (this.state.installing) return -3; //Server is installing
    if (this.state.updating) return -4; //Server is updating
    if (this.state.configuring) return -5; //Server is configuring
    this.log("Starting server {label}", {label: this.config.label});
    this.state.starting = false;
    this.uptime = new Date().getTime();
    this.players = null;
    this.tps = null;
    this.nvlaMonitorInstalled = false;
    this.checkInProgress = false;
    this.playerlistCallback = null;
    this.playerlistTimeout = null;
    this.state.idleMode = false;
    this.updatePending = false;
    this.state.delayedRestart = false;
    this.state.restarting = false;
    this.state.delayedStop = false;
    this.errorState = null;
    this.stateUpdate();
    this.playerlistTimeoutCount = 0;
    try {
      this.socketServer = await this.createSocket();
      const address = this.socketServer.address();
      this.consolePort = address.port;
      this.socketServer.on("connection", this.handleServerConnection.bind(this));
      this.log("Console socket created on {port}", {port: this.consolePort});
    } catch (e) {
      this.errorState = "Failed to create console socket: " + e;
      this.error("Failed to create console socket: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return -3;
    }
    let executable = fs.existsSync(path.join(this.serverInstallFolder, "SCPSL.exe")) ? path.join(this.serverInstallFolder, "SCPSL.exe") : fs.existsSync(path.join(this.serverInstallFolder, "SCPSL.x86_64")) ? path.join(this.serverInstallFolder, "SCPSL.x86_64") : null;
    if (executable == null) {
      this.errorState = "Failed to find executable";
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
      this.errorState = "Failed to start server: " + e;
      return -5;
    }
    this.state.starting = true;
    this.process.stdout.on("data", this.handleStdout.bind(this));
    this.process.stderr.on("data", this.handleStderr.bind(this));
    this.process.on("error", this.handleError.bind(this));
    this.process.on("exit", this.handleExit.bind(this));
    if (this.timeout != null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.timeout = setTimeout(this.startTimeout.bind(this), 1000*this.config.maximumStartupTime);
  }

  /**
   * Ran when the server takes too long to start
   */
  async startTimeout () {
    this.errorState = "Server startup took too long, check console";
    this.error("{label} Startup took too long, stopping", {label: this.config.label});
    this.stop(true, true);
  }

  stop(forced) {
    if (this.process == null) return -1; //Server process not active
    if (this.state.uninstalling) return -5; //Server uninstalling
    if ((this.state.stopping && !this.state.delayedStop) || (this.state.starting)) {
      this.log("Killing server {label}", {label: this.config.label}, {color: 6});
      this.process.kill(9);
    } else if (this.state.delayedStop || (!this.state.stopping && this.players != null && this.players.length <= 0) || forced) {
      this.log("Force Stopping server {label}", {label: this.config.label}, {color: 6});
      this.state.delayedStop = false;
      this.state.stopping = true;
      this.command("stop");
      this.stateUpdate();
      if (this.timeout != null) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
      this.timeout = setTimeout(this.stopTimeout.bind(this), 1000*this.config.maximumShutdownTime);
      return;
    } else if (!this.state.stopping && this.players != null && this.players.length > 0) {
      this.log("Stopping server {label} Delayed", {label: this.config.label}, {color: 6});
      this.stateUpdate();
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

  restart(forced) {
    if (this.process == null) return this.start();
    if (this.state.stopping) return -2; //Server stopping
    if (this.state.starting) return -3; //Server restarting
    if (this.state.uninstalling) return -5; //Server uninstalling
    if (this.state.delayedStop) this.command("snr");
    if (this.state.delayedRestart || (!this.state.restarting && this.players != null && this.players.length <= 0) || forced) {
      this.log("Force Restarting server {label}", {label: this.config.label}, {color: 6});
      this.state.delayedRestart = false;
      this.state.restarting = true;
      this.command("softrestart");
      this.stateUpdate();
      if (this.timeout != null) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
      this.timeout = setTimeout(this.restartTimeout.bind(this), 1000*this.config.maximumRestartTime);
      return;
    } else if (!this.state.restarting && this.players != null && this.players.length > 0) {
      this.log("Restarting server {label} delayed", {label: this.config.label}, {color: 6});
      this.stateUpdate();
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

  cancelAction () {
    //requires support for canceling installs and updates
    if (this.state.updating && this.main.steam.activeProcess != null) {
      this.main.steam.cancel = true;
      this.main.steam.activeProcess.kill();
    } else if (this.state.installing && this.main.steam.activeProcess != null) {
      this.main.steam.cancel = true;
      this.main.steam.activeProcess.kill();
    }
    if (this.state.delayedRestart) this.command("rnr");
    else if (this.state.delayedStop) this.command("snr");
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

  cancel = false;

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
      if (str.trim() == "") return;
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
    this.cancel = false;
    this.verbose("Steam binary path: {path}", { path: this.binaryPath }, { color: 6 });
    this.activeProcess = pty.spawn(process.platform === "win32" ? "powershell.exe" : "bash", [], {cwd: path.parse(this.binaryPath).dir, env: process.platform == "linux" ? Object.assign({LD_LIBRARY_PATH: path.parse(this.binaryPath).dir}, process.env) : process.env});
    
    let proc = this.activeProcess;
    
    proc.write((process.platform == "darwin" ? this.binaryPath : "./"+path.parse(this.binaryPath).base) + " " + params.join(" ") + "\r");
    proc.write(process.platform === "win32" ? "exit $LASTEXITCODE\r" : "exit $?\r");

    proc.on("data", function (data) {
        let d = data.toString().split("\n");
        for (var i in d) {
          try {
            this.onstdout(this.runId, d[i].replaceAll("\r", ""), true);
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
    if (this.cancel) {
      this.error("Steam execution cancelled", null, { color: 3 });
      this.cancel = false;
      return -1;
    }
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
   * @param {String} runId
   * @param {Server} server
   */
  async runWrapper(params, runId, server) {
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
    let binding;
    if (server != null) {
      binding = server.steamStateUpdate.bind(server);
      this.on("state", binding);
      this.on("percentage", binding);
    }
    try {
      result = await this.run(params);
    } catch (e) {
      this.log("Steam execution caused exception: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    if (server != null) {
      this.removeListener("state", binding);
      this.removeListener("percentage", binding);
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

  /**
   * 
   * @param {string} appId 
   * @param {string} path 
   * @param {string} beta 
   * @param {string} betaPassword 
   * @param {Array<String>} customArgs 
   * @param {Server} server 
   * @returns 
   */
  async downloadApp(appId, path, beta, betaPassword, customArgs, server) {
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
      Math.floor(Math.random() * 10000000000), server
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

class addresses {
  public;

  /** @type Array<String> */
  local = [];

  port;

  constructor (port) {
      this.port = port;
      this.public = null;
      this.local = [];
  }

  async populate () {
      const nets = os.networkInterfaces();
      this.local = [];
      for (let i in nets) {
          let intf = nets[i];
          for (let x in intf) {
            let net = intf[x];
            const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
            if (net.family === familyV4Value && !net.internal && !this.local.includes(net.address)) this.local.push(net.address);
          }
      }
      try {
          this.public = await axios({
              method: "get",
              url: 'https://api.ipify.org/',
              timeout: 10000
          });
          this.public = this.public.data;
          return true;
      } catch (e) {
          this.public = null;
          return false;
      }
  }

  trim () {
      let o = {};
      o.public = this.public;
      o.local = this.local;
      o.port = this.port;
      return o;
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

  /** @type number */
  totalMemory;

  /** @type boolean */
  lowMemory = false;

  updateInterval;

  uptime = Date.now();

  /** @type boolean */
  stopped = false;

  /** @type boolean */
  updateInProgress = false;

  verkeyWatch;

  /** @type import("dgram")["Socket"]["prototype"] */
  echoServer;

  cpuBalancingSupported;

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

    this.network = new addresses(this.config.echoServerPort);    

    this.verkeyWatch = chokidar.watch(path.parse(verkeyPath).dir, {ignoreInitial: true,persistent: true});
    this.verkeyWatch.on("all", this.userSCPSLAppdateUpdate.bind(this));
    this.verkeyWatch.on("error", e => this.error("Verkey file Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));

    this.updateInterval = setInterval(this.update.bind(this), 1000);
  }

  async userSCPSLAppdateUpdate (event, filePath) {
    if (this.stopped) return;
    filePath = path.relative(path.parse(verkeyPath).dir, filePath);
    if (path.parse(filePath).ext != ".txt" || path.parse(filePath).name != "verkey") return;
    if (event == "add" || event == "change") {
      let p = path.join(path.parse(verkeyPath).dir, filePath);
      let data;
      try {
        data = fs.readFileSync(p).toString();
      } catch (e) {
        this.error("Failed to read verkey file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        return;
      }
      if (data.trim() == "") this.config.verkey = null;
      else this.config.verkey = data.trim();
      fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(this.config, null, 4));
    } else if (event == "unlink") {
      this.config.verkey = null;
      fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(this.config, null, 4));
    }
    this.info("Verkey file event: {event} {filePath}", { event: event, filePath: filePath }, { color: 6 });
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
    if (this.updateInProgress) return;
    this.updateInProgress = true;
    try {
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
      this.memory = (osAlt.totalmem()-osAlt.freemem())*1000000;
      this.totalMemory = osAlt.totalmem()*1000000;
      this.updateNetwork();
      if (this.vega != null && this.vega.connected) this.vega.client.sendMessage(new mt.machineStatus(this.vega));
    } catch (e) {
      this.error("Failed to cycle update: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.updateInProgress = false;
  }

  async updateNetwork () {
    await this.network.populate();
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

  async handleConfigEdit (property, subProperty) {
    //We handle situations where config edits require restarting / reconfiguring things live here
  }

  async restart() {
    console.log("This is not implimented yet");
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
    if (this.config.cpuBalance) {
      this.log("CPU balancing is enabled, checking taskset");
      await this.checkTaskSet();
      if (this.cpuBalancingSupported) {
        this.on("serverReady", this.rebalanceServers.bind(this));
      }
    }
    this.log("Steam ready", null, { color: "blue" });
    this.vega = new Vega(this);
    this.vega.connect();
    this.echoServer = udp.createSocket('udp4');
    this.echoServer.on('error', this.echoServerError.bind(this));
    this.echoServer.on('message', this.echoServerMessage.bind(this));
    this.echoServer.bind(this.config.echoServerPort, this.config.echoServerAddress);
  }

  cpuRebalanceInProg = false;

  async rebalanceServers () {
    while (this.cpuRebalanceInProg) await new Promise(r => setTimeout(r, 500));
    this.cpuRebalanceInProg = true;
    let currentCount = 0;
    let primeCpus = new Map();
    for (let y = 0; y < availableCpus; y++) primeCpus.set(y, 0);
    for (var entry of this.ServerManager.servers.entries()) {
        var i = entry[0], server = entry[1];
        if (!server.state.running || server.process == null || server.process.pid == null) continue;
        let cpus = [];
        for (let x = 0; x < this.config.cpusPerServer; x++) {
            let cpu = currentCount%availableCpus;
            if (!cpus.includes(cpu)) cpus.push(cpu);
            currentCount++;
        }
        cpus.sort(function (a,b) {
            return primeCpus.get(a)-primeCpus.get(b);
        }.bind(primeCpus));
        var main = cpus[0];
        primeCpus.set(main, primeCpus.get(main)+1);
        var secondaries = cpus.filter(x => x != main);
        let commands = [];
        try {
            commands.push("taskset -a -p " + convertToMask(secondaries) + " " + server.process.pid);
            commands.push("taskset -p " + convertToMask(main) + " " + server.process.pid);
        } catch (e) {
          this.error("Failed generating mask for: {main} {secondaries} {server}\n{e}", { main: main, secondaries: secondaries, server: server != null ? server.config.label : "null", e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
        }
        for (let v in commands) {
            let command = commands[v];
            try {
                let exitCode = await runCommand(command);
                if (exitCode != 0) throw "Error occured setting the process afffinity";
                this.log("CPU Affinity set - " + command);
            } catch (e) {
                this.error("Failed running command: {command}\n{e}", { command: command, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
            }
        }
    }
    this.cpuRebalanceInProg = false;
  }

  async checkTaskSet () {
    let exitcode = await runCommand('taskset -V');
    if (exitcode != 0) {
      this.error("Taskset is not available on this system");
      this.cpuBalancingSupported = false;
    } else {
      this.log("Taskset is available on this system");
      this.cpuBalancingSupported = true;
    }
}

  /**
   * @param {Buffer} msg 
   * @param {udp.RemoteInfo} rinfo 
   */
  echoServerMessage (msg, rinfo) {
    try {
      this.echoServer.send("1", rinfo.port, rinfo.address);
    } catch (e) {
      this.error("Echo server response error: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
  }

  echoServerError (e) {
    this.error("Echo server error: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
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




class FileInfo {
  /** @type string */
  md5;

  /** @type string */
  name = "";

  /** @type Array<string> */
  path = null;

  /** @type string */
  type = "";

  /**
   * 
   * @param {FileType} fileType 
   */
  constructor (fileType) {
      this.md5 = fileType.md5;
      this.type = fileType.subtype;
      if (fileType instanceof ConfigFile) this.path = fileType.path;
      else this.path = fileType.filePath;
      this.name = fileType.name;
  }
}
module.exports.FileInfo = FileInfo;

class downloadSettings {
  /* @type {string} */
  url;

  /* @type {string} */
  name;

  /* @type {string} */
  password;

  /* @type {string} */
  path;

  /* @type {string} */
  type;

  /* @type {string} */
  subtype;

  /* @type {string} */
  id;

  /* @type {string} */
  outputPath;

  constructor (){

  }
}

class fileDownload {

  /** @type string */
  id;

  /** @type downloadSettings */
  config;

  resolves = {resolve: null, reject: null};

  solved = false;

  /** @type ChildProcess */
  proc;

  /** @type Vega */
  vega;

  /**
   * 
   * @param {Vega} vega 
   * @param {object} resolves 
   * @param {string} type 
   * @param {string} name 
   * @param {Server} server 
   * @param {string} spath 
   */
  constructor(vega, resolves, type, subtype, name, server, spath) {
      this.vega = vega;
      this.resolves = resolves;
      this.id = vega.randomFileRequestId();
      vega.downloadRequests.set(this.id, this);
      this.config = new downloadSettings();
      this.config.type = type;
      this.config.subtype = subtype;
      this.config.password = vega.main.config.vega.password;
      this.config.id = server.config.id;
      this.config.name = name;
      this.config.url = "http://"+vega.main.config.vega.host+":"+vega.httpPort+"/download";
      if (type == "assemblies") {
        if (subtype == "plugin") {
            this.config.path = null;
            this.config.outputPath = path.join(server.pluginsFolderPath, name+".dll");
        } else if (subtype == "dependency") {
            this.config.path = null;
            this.config.outputPath = path.join(server.pluginsFolderPath, "dependencies", name+".dll");
        } else if (subtype == "customAssembly") {
            this.config.path = null;
            this.config.outputPath = path.join(server.serverCustomAssembliesFolder, name+".dll");
        }
      } else if (type = "configFile") {
        if (subtype == "pluginConfig") {
          this.config.path = JSON.stringify(spath);
          this.config.outputPath = path.join(server.pluginsFolderPath, joinPaths(spath), name);
        } else if (subtype == "serverConfig") {
          this.config.path = JSON.stringify(spath);
          this.config.outputPath = path.join(server.serverConfigsFolder, joinPaths(spath), name);
        } else if (subtype == "globalServerConfig") {
          this.config.path = JSON.stringify(spath);
          this.config.outputPath = path.join(server.globalDedicatedServerConfigFiles, joinPaths(spath), name);
        }
      }
  }

  start () {
    try {
      this.proc = fork(path.join(__dirname, "download.js"));
      this.proc.on("message", this.onDownloadProcMess.bind(this));
      this.proc.on("close", this.onDownloadProcClose.bind(this));
      this.proc.on("error", this.onDownloadProcError.bind(this));
    } catch (e) {
        resolves.reject("Failed to fork download process:\n"+e);
    }
  }

  async onDownloadProcMess (m) {
      if (m.type == "ready") {
          this.proc.send(Object.assign(this.config, {mtype: "config"}));
      } else if (m.type == "error") {
          if (this.solved) return;
          this.solved = true;
          this.resolves.reject(m.message);
          this.proc.kill();
      }
  }

  async onDownloadProcClose (code) {
      this.proc = null;
      if (this.solved) return;
      this.vega.downloadRequests.delete(this.id);
      this.solved = true;
      if (code != 0) this.resolves.reject("Download exited with non-zero status code: "+code);
      this.resolves.resolve();
  }

  async onDownloadProcError (e) {
    console.error(e);
  }

  kill () {
      if (this.proc != null) this.proc.kill();
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

  /** @type {Map<string, fileDownload>} */
  downloadRequests = new Map();

  /** @type {messageHandler} */
  messageHandler;

  /** @type {boolean} */
  connected = false;

  /** @type NVLA["logger"] */
  logger;

  /** @type number */
  httpPort;

  /**
   * @param {NVLA} main
   */
  constructor(main) {
    this.main = main;
    this.main.on("serverStateChange", this.serverStateChange.bind(this));
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

  /**
   * @param {Server} server 
   */
  serverStateChange (server) {
    this.client.sendMessage(new mt.serverStateUpdate(server));
  }

  async connect() {
    if (this.main.stopped) return;
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
      if (this.main.stopped) return;
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

  /**
   * @returns {string}
   */
  randomDownloadId() {
    let id = Math.random().toString(36).slice(2);
    if (this.downloadRequests.has(id)) return this.randomDownloadId();
    return id;
  }

  async onAuthenticated() {
    this.connected = true;
    this.client.sendMessage(new mt.servers(this));
  }

  /**
   * @param {string} type 
   * @param {string} name 
   * @param {Server} server 
   * @param {Array<string>} path 
   */
  downloadFile (type, subtype, name, server, spath) {
    if (!this.connected) throw "Not connected to Vega";
    /** @type downloadSettings */

    let resolves = {};
    let promise = new Promise(function (resolve, reject) {
      this.resolve = resolve;
      this.reject = reject;
    }.bind(resolves));
    
    
    let download;
    try {
      download = new fileDownload(this, resolves, type, subtype, name, server, spath);
      download.start();
    } catch (e) {
      console.error(e);
      setTimeout(resolves.reject.bind(null, "Failed to build download process:\n"+e), 10);
      return promise;
    }

    if (this.main.config.debug) this.log("Requesting file download: {settings}", { settings: download.config });

    return promise;
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getAssemblies(type, id) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting assemblies of type: {subtype}", { subtype: type });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(new mt.assembliesRequest(this, { resolve: resolve, reject: reject }, type, id));
    });
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getConfigs(type, id) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting configs of type: {subtype}", { subtype: type });
    return new Promise((resolve, reject) => {
      this.client.sendMessage(new mt.configsRequest(this, { resolve: resolve, reject: reject }, type, id));
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
    this.downloadRequests.forEach((v, k) => {
      v.resolves.reject("Vega Connection closed");
      v.kill();
      this.downloadRequests.delete(k);
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
  serverState: serverState,
  addresses: addresses,
  FileInfo: FileInfo,
};

