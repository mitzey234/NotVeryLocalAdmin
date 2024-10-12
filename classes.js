/* eslint-disable no-empty */
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

module.exports = {};

function getCPUPercent () {
    return new Promise((resolve, reject) => {
        osAlt.cpuUsage(function(resolve, reject, v){
            resolve(Math.round(v*10000)/100);
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
  for (let i = 0; i<int.length/2; i++) arr[i] = int[i*2] + int[i*2+1];
  var arr2 = [];
  for (let i = 0; i<arr.length; i++) arr2[i] = arr[arr.length-i-1];
  return Buffer.from(arr2.join(""), "hex");
}

/**
* @param {string | Array<string>} path 
* @param {object} obj 
* @param {object} value 
*/
function setProperty (path, obj, value) {
  if (typeof path == "string") path = path.split(".");
  let data = obj;
  for (let i = 0; i < path.length; i++) {
    if (i == path.length-1) {
      data[path[i]] = value;
      return;
    }
    if (data[path[i]] == null) data[path[i]] = {};
    data = data[path[i]];
  }
  return;
}

/**
* @param {string | Array<string>} path 
* @param {object} obj 
*/
function getProperty(path, obj) {
  if (typeof path == "string") path = path.split(".");
  let data = obj;
  for (let i in path) {
      if (data == null) return data;
      data = data[path[i]];
  }
  return data;
}

function convertToMask (cpus) {
  if (typeof cpus == "object" && Array.isArray(cpus)) {
      let sum = 0;
      for (let i in cpus) sum += Math.pow(2,cpus[i]);
      return sum.toString(16);
  } else if (typeof cpus == "number") {
      return Math.pow(2,cpus).toString(16);
  } else {
      throw "Unsupported type:" + typeof cpus;
  }
}

function runCommand (command) {
  return new Promise(function (resolve) {
      let run = exec(command);
      run.on("close", resolve);
  }.bind(command));
}

function processPrintF(info, seq) {
	let data = (info[Symbol.for("splat")] || [])[0] || [];
	let metadata = (info[Symbol.for("splat")] || [])[1] || [];
  if (info.message == null) info.message = "";
  info.message = info.message.toString();
	if (typeof data == "object" && !seq) for (let i in data) if (i != "type") info.message = info.message.replaceAll("{" + i + "}", typeof data[i] != "string" && (data[i] != null && data[i].constructor != null ? data[i].constructor.name != "Error" : true) ? util.inspect(data[i], false, 7, false) : data[i].toString());
  if (metadata.color != null && seq) info.consoleColor = metadata.color;
	if (metadata.color != null && colors[metadata.color] != null && !seq) info.message = colors[metadata.color](info.message);
	if (!seq) info.message = info.message + (info.stack != null ? "\n" + info.stack : "");
	if (!seq) info.message = info.message.replaceAll("\r", "").split("\n");
	if (!seq) for (let i in info.message) info.message[i] = `[${currTime(true)}] ${info.type != null ? `[${resolveType(info.type, info, seq)}] ` : "" }` + info.message[i];
	if (!seq) info.message = info.message.join("\n");
	if (seq && info.type != null) {
		info.type = resolveType(info.type, info, seq);
	}
}

function resolveType(type, info, seq) {
  if (info == null) info = {};
  if (info.messageType != null && typeof type == "string") return info.messageType;
  var t;
  if (typeof type == "string") {
    if (objectTypes[type] != null) {
      t = objectTypes[type];
      if (!seq && consoleObjectTypes[type] != null) t = consoleObjectTypes[type];
      return typeof t == "function" ? t(type, info) : t;
    } else return type;
  } else if (typeof type == "object") {
    if (type.constructor == null) return "Unknown";
    let res = type.constructor.name;
    if (objectTypes[res] != null) {
      t = objectTypes[res];
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
  for (let i in list) {
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

class winstonLoggerSeq { 
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
    this.process = fork(path.join(__dirname, "winstonLoggerSeq.js"));
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
          if (this.seq.process != null && !this.stopped) this.seq.log(info);
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

  async onMessasge (msg) {
    if (msg.type == "started") {
      this.process.send({ type: "config", settings: this.settings });
    } else if (msg.type == "ready") {
      this.main.log("Winston Seq Logger ready", null, {color: 2});
      if (this.main.logger.transports.find(t => t == this.transport) == null) this.main.logger.add(this.transport);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
    }
  }

  onError (err) {
    this.errored = true;
    if (this.process.killed) {
      this.process = null;
      try {
        this.main.logger.remove(this.transport);
      } catch (e) {
        this.main.error("Failed removing transport");
      }
    }
    this.main.error("Winston Seq Logger error: {err}", { err: err.code || err.message, stack: err.stack });
    if (this.reject != null) {
      this.reject("Winston Seq Logger error\n", err);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
    }
  }

  onExit (code) {
    this.process = null;
    try {
      this.main.logger.remove(this.transport);
    } catch (e) {
      this.main.error("Failed removing transport");
    }
    if (this.stopping) {
      this.stopping = false;
      this.main.error("Winston Seq Logger exited with code {code}", { code: code });
      return;
    }
    if (this.reject != null) {
      this.reject("Winston Seq Logger exited unexpectedly during start with code " + code);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
      return;
    }
    this.main.error("Winston Seq Logger exited unexpectedly with code {code}", { code: code });
    this.start();
  }
}

class winstonLoggerLoki { 
  /** @type {NVLA} */
  main;

  /** @type {import('child_process').ChildProcess } */
  process;

  /** @type lokiSettings */
  settings;

  stopping = false;

  promise;

  /** @type Function */
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
    this.process = fork(path.join(__dirname, "winstonLoggerLoki.js"));
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
        if (this.config.loki.enabled) {
          processPrintF(info, true);
          info.message = info.message.replace(ansiStripRegex, "");
          if (this.loki.process != null && !this.stopped) this.loki.log(info);
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

  async onMessasge (msg) {
    if (msg.type == "started") {
      this.process.send({ type: "config", settings: this.settings });
    } else if (msg.type == "ready") {
      this.main.log("Winston Loki Logger ready", null, {color: 2});
      if (this.main.logger.transports.find(t => t == this.transport) == null) this.main.logger.add(this.transport);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
    }
  }

  onError (err) {
    this.errored = true;
    if (this.process.killed) {
      this.process = null;
      try {
        this.main.logger.remove(this.transport);
      } catch (e) {
        this.main.error("Failed removing transport");
      }
    }
    this.main.error("Winston Loki Logger error: {err}", { err: err.code || err.message, stack: err.stack });
    if (this.reject != null) {
      this.reject("Winston Loki Logger error\n", err);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
    }
  }

  onExit (code) {
    this.process = null;
    try {
      this.main.logger.remove(this.transport);
    } catch (e) {
      this.main.error("Failed removing transport");
    }
    if (this.stopping) {
      this.stopping = false;
      this.main.error("Winston Loki Logger exited with code {code}", { code: code });
      return;
    }
    if (this.reject != null) {
      this.reject("Winston Loki Logger exited unexpectedly during start with code " + code);
      clearTimeout(this.timeout);
      this.timeout = null;
      this.resolve();
      this.resolve = null;
      this.reject = null;
      return;
    }
    this.main.error("Winston Loki Logger exited unexpectedly with code {code}", { code: code });
    this.start();
  }
}

class settings {
  /** @type NVLA */
  main;

  /** @type string */
  serversFolder = path.resolve(path.join(__dirname, "servers"));

  /** @type vegaSettings */
  vega;

  /** @type seqSettings */
  seq;

  /** @type lokiSettings */
  loki;

  /** @type logSettings */
  logSettings;

  /** @type number */
  echoServerPort = 5050;

  /** @type string */
  echoServerAddress = "0.0.0.0";

  level = "info";

  minimumMemoryThreashold = 500000000;

  criticalMemoryThreashold = 200000000;

  verkey = null;

  cpuBalance = true;

  cpusPerServer = 2;

  clearLALogs = true;

  constructor(main) {
    this.main = main;
    if (!fs.existsSync(path.join(__dirname, "config.json"))) fs.writeFileSync(path.join(__dirname, "config.json"), "{}");
    /** @type {import("./config.json")} */
    let obj = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json")))
    this.vega = new vegaSettings(obj.vega);
    this.logSettings = new logSettings(obj.logSettings);
    this.seq = new seqSettings(obj.seq);
    this.loki = new lokiSettings(obj.loki);
    for (var i in obj) {
      if (i == "vega" || i == "logSettings" || i == "seq" || i == "loki") continue;
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
    this.saveConfg();
  }

  async edit (path, value) {
    let currentValue = getProperty(path, this);
    if (currentValue != null && (typeof currentValue == "function" || currentValue.prototype instanceof NVLA)) return; //Don't let it edit these
    setProperty(path, this, value);
    await this.handleEdit(path, value, currentValue);
    this.saveConfg();
  }

  async handleEdit (path, value, previous) {
    try {
      await this.main.handleConfigEdit(path, value, previous);
    } catch (e) {
      this.main.error("Failed to handle config edit: {e} ", {e: e != null ? e.code || e.message : e, stack: e.stack});
    }
  }

  simplified () {
    let obj = {};
    for (let i in this) if (typeof this[i] != "function" && i != "main") obj[i] = this[i];
    return obj;
  }

  saveConfg () {
    fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(this.simplified(), null, 4));
  }
}

class logSettings {
  logfolder = "./Logs";

  /** @type string */
  maxSize = "10M";

  /** @type number */
  maxCount = 10;

  /** Tells NVLA if it should clean up common SCP SL outputs that can be ignored to save space
  * @type boolean */
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

class lokiSettings {
  /** @type string */
  host = "127.0.0.1";

  /** @type boolean */
  secure = false;

  /** @type string */
  basicAuth;

  batching = false;

  batchInterval = 1;

  /** @type number */
  timeout = 0;

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
  label = os.hostname();

  /** @type string */
  id = null;

  constructor(obj) {
    for (var i in obj) {
      this[i] = obj[i];
    }
  }
}

class ServerConfig {
  /** @type NVLA */
  main;

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

  paths = new ServerPaths(this);

  ignoreProperties = ["ignoreProperties", "paths", "filename", "main"];

  constructor (m, data) {
    this.main = m;
    if (data != null) {
      for (let i in this) if (!this.ignoreProperties.includes(i) && typeof this[i] != "function" && data[i] != null) this[i] = data[i]; 
    }
  }

  toString () {
    let o = {};
    for (let i in this) if (!this.ignoreProperties.includes(i) && typeof this[i] != "function") o[i] = this[i]; 
    return JSON.stringify(o, null, 4);
  }

}

class ServerPaths {
  /** @type ServerConfig */
  config;

  /** @param {ServerConfig} c */
  constructor (c) {
    this.config = c;
  }

  get serverContainer () {
    return path.join(path.resolve(this.config.main.config.serversFolder), this.config.id);
  }

  get serverInstallFolder () {
    return path.join(this.serverContainer, "scpsl");
  }

  get dedicatedServerAppdata () {
    return path.join(this.serverInstallFolder, "AppData", "SCP Secret Laboratory");
  }

  get pluginsFolderPath () {
    return path.join(this.dedicatedServerAppdata, "PluginAPI", "plugins", "global");
  }

  get serverConfigsFolder () {
    return path.join(this.serverInstallFolder, "AppData", "config", this.config.port.toString());
  }

  get globalDedicatedServerConfigFiles () {
    return path.join(this.serverInstallFolder, "AppData", "config", "global");
  }

  get serverCustomAssembliesFolder () {
    return path.join(this.serverInstallFolder, "SCPSL_Data", "Managed");
  }
}

class restartTime {
  /** @type number */
  hour = 0;

  /** @type number */
  minute = 0;
}

class serverState {
  _updating = false;
  _installing = false;
  _uninstalling = false;
  _restarting = false;
  _configuring = false;
  _starting = false;
  _stopping = false;
  _running = false;
  _delayedRestart = false;
  _delayedStop = false;
  _idleMode = false;
  _transfering = false;
  _error = null;
  _updatePending = false;
  _percent = null;
  _steam = null;

  /** @type number */
  _uptime = null;

  /** @type Array<string> */
  _players = null;

  /** @type number */
  _tps = null;

  /** @type number */
  _roundStartTime = null;

  /** @type number */
  _memory = null;

  /** fractional cpu usage 
   * @type number */
  _cpu = null;

  /** @type Server */
  server;

  constructor (s) {
    this.server = s;
  }

  get updatePending () {
    return this._updatePending;
  }

  set updatePending (value) {
    this._updatePending = value;
    this.server.main.emit("updateServerState", {key: "updatePending", value: value, server: this.server});
  }

  get error () {
    return this._error;
  }

  set error (value) {
    if (this._error == value) return;
    this._error = value;
    this.server.main.emit("updateServerState", {key: "error", value: value, server: this.server});
  }

  get percent () {
    return this._percent;
  }

  set percent (value) {
    if (this._percent == value) return;
    this._percent = value;
    this.server.main.emit("updateServerState", {key: "percent", value: value, server: this.server});
  }

  get steam () {
    return this._steam;
  }

  set steam (value) {
    if (this._steam == value) return;
    this._steam = value;
    this.server.main.emit("updateServerState", {key: "steam", value: value, server: this.server});
  }

  get updating () {
    return this._updating;
  }

  set updating (value) {
    if (this._updating == value) return;
    this._updating = value;
    this.server.main.emit("updateServerState", {key: "updating", value: value, server: this.server});
  }

  get installing () {
    return this._installing;
  }

  set installing (value) {
    if (this._installing == value) return;
    this._installing = value;
    this.server.main.emit("updateServerState", {key: "installing", value: value, server: this.server});
  }

  get uninstalling () {
    return this._uninstalling;
  }

  set uninstalling (value) {
    if (this._uninstalling == value) return;
    this._uninstalling = value;
    this.server.main.emit("updateServerState", {key: "uninstalling", value: value, server: this.server});
  }

  get restarting() {
    return this._restarting;
  }

  set restarting(value) {
    if (this._restarting == value) return;
    this._restarting = value;
    this.server.main.emit("updateServerState", { key: "restarting", value: value, server: this.server });
  }

  get configuring() {
    return this._configuring;
  }

  set configuring(value) {
    if (this._configuring == value) return;
    this._configuring = value;
    this.server.main.emit("updateServerState", { key: "configuring", value: value, server: this.server });
  }

  get starting() {
    return this._starting;
  }

  set starting(value) {
    if (this._starting == value) return;
    this._starting = value;
    this.server.main.emit("updateServerState", { key: "starting", value: value, server: this.server });
  }

  get stopping() {
    return this._stopping;
  }

  set stopping(value) {
    if (this._stopping == value) return;
    this._stopping = value;
    this.server.main.emit("updateServerState", { key: "stopping", value: value, server: this.server });
  }

  get running() {
    return this._running;
  }

  set running(value) {
    if (this._running == value) return;
    this._running = value;
    this.server.main.emit("updateServerState", { key: "running", value: value, server: this.server });
  }

  get delayedRestart() {
    return this._delayedRestart;
  }

  set delayedRestart(value) {
    if (this._delayedRestart == value) return;
    this._delayedRestart = value;
    this.server.main.emit("updateServerState", { key: "delayedRestart", value: value, server: this.server });
  }

  get delayedStop() {
    return this._delayedStop;
  }

  set delayedStop(value) {
    if (this._delayedStop == value) return;
    this._delayedStop = value;
    this.server.main.emit("updateServerState", { key: "delayedStop", value: value, server: this.server });
  }

  get idleMode() {
    return this._idleMode;
  }

  set idleMode(value) {
    if (this._idleMode == value) return;
    this._idleMode = value;
    this.server.main.emit("updateServerState", { key: "idleMode", value: value, server: this.server });
  }

  get transfering() {
    return this._transfering;
  }

  set transfering(value) {
    if (this._transfering == value) return;
    this._transfering = value;
    this.server.main.emit("updateServerState", { key: "transfering", value: value, server: this.server });
  }

  get uptime() {
    return this._uptime;
  }

  set uptime(v) {
    if (this._uptime == v) return;
    this._uptime = v;
    this.server.main.emit("updateServerState", {key: "uptime", value: v, server: this.server});
  }

  get players () {
    return this._players;
  }

  set players(v) {
    if (Array.isArray(v) && Array.isArray(this._players) && v.length == this._players.length && this._players.filter(e => !v.includes(e)).length == 0 && v.filter(e => !this._players.includes(e)) == 0) return;
    this._players = v;
    this.server.main.emit("updateServerState", {key: "players", value: v, server: this.server});
  }

  get tps() {
    return this._tps;
  }

  set tps(v) {
    if (this._tps == v) return;
    this._tps = v;
    this.server.main.emit("updateServerState", {key: "tps", value: v, server: this.server});
  }

  get roundStartTime () {
    return this._roundStartTime;
  }

  set roundStartTime (v) {
    if (this._roundStartTime == v) return;
    this._roundStartTime = v;
    this.server.main.emit("updateServerState", {key: "roundStartTime", value: v, server: this.server});
  }

  get memory () {
    return this._memory;
  }

  set memory (v) {
    if (this._memory == v) return;
    this._memory = v;
    this.server.main.emit("updateServerState", {key: "memory", value: v, server: this.server});
  }

  get cpu () {
    return this._cpu;
  }

  set cpu (v) {
    if (this._cpu == v) return;
    this._cpu = v;
    this.server.main.emit("updateServerState", {key: "cpu", value: v, server: this.server});
  }

  toObject() {
    return {
      updating: this._updating,
      installing: this._installing,
      uninstalling: this._uninstalling,
      restarting: this._restarting,
      configuring: this._configuring,
      starting: this._starting,
      stopping: this._stopping,
      running: this._running,
      delayedRestart: this._delayedRestart,
      delayedStop: this._delayedStop,
      idleMode: this._idleMode,
      transfering: this._transfering,
      error: this._error,
      updatePending: this._updatePending,
      percent: this._percent,
      steam: this._steam,
      uptime: this._uptime,
      players: this._players,
      tps: this._tps,
      roundStartTime: this._roundStartTime,
      memory: this._memory,
      cpu: this._cpu
    }
  }
}

class FileEvent {
  /** @type string */
  type;

  /** @type string */
  event;

  /** @type string */
  filePath;
  
  /** @type string */
  parentType;
  
  /** @type string */
  fid;
  
  constructor (type, event, filePath, parentType) {
      this.type = type;
      this.event = event;
      this.filePath = filePath;
      this.parentType = parentType;
      this.fid = crypto.createHash('sha256').update(filePath + type + parentType).digest('hex');
  }
}

class FileEventHandler {
    
  /** @type Server */
  main;

  /** @type Map<string, FileEvent> */
  events = new Map();

  timeout;

  /**
   * @param {Server} main 
   */
  constructor (main) {
      this.main = main;
  }

  registerEvent (type, event, filePath, parentType) {
      if (this.timeout != null) {
          clearTimeout(this.timeout);
          this.timeout = null;
      }
      this.timeout = setTimeout(this.executeEvents.bind(this), 750);
      let ev = new FileEvent(type, event, filePath, parentType);
      //if (this.events.has(ev.fid)) console.log("Overriding duplicate event");
      this.events.set(ev.fid, ev);
  }

  executeEvents () {
      this.timeout = null;
      let arr = Array.from(this.events.values());
      this.events.clear();
      for (let i in arr) {
          /** @type FileEvent */
          let fileEvent = arr[i];
          this.main.configFileEvent.bind(this.main)(fileEvent.type, fileEvent.event, fileEvent.filePath);
      }
  }
}

class ServerMonitor {
  /** @type Server */
  server;

  /**
   * @param {Server} s 
   */
  constructor (s) {
    this.server = s;
    this.verbose = this.server.verbose.bind(this.server);
    this.log = this.server.log.bind(this.server);
    this.error = this.server.error.bind(this.server);
  }

  /** @type boolean */
  checkInProgress = false;

  /** @type Function */
  checkCallback;

  checkTimeout;

  monitorTimeout;

  updateInterval;

  checkTimeoutCount = 0;

  /** @type boolean */
  _nvlaMonitorInstalled = false;

  /** @type boolean */
  _enabled = false;

  get enabled () {
    return this._enabled;
  }

  set enabled (value) {
    if (value == this._enabled) return;
    if (value == true) {
      if (this.updateInterval != null) clearInterval(this.updateInterval);
      this.updateInterval = setInterval(this.update.bind(this), 1000);
      this.checkTimeoutCount = 0;
      if (this.checkTimeout != null) clearTimeout(this.checkTimeout);
      this.checkTimeout = null;
      if (this.monitorTimeout != null) clearTimeout(this.monitorTimeout);
      this.monitorTimeout = null;
    } else {
      if (this.updateInterval != null) clearInterval(this.updateInterval);
      this.updateInterval = null;
      if (this.checkTimeout != null) clearTimeout(this.checkTimeout);
      this.checkTimeout = null;
      if (this.monitorTimeout != null) clearTimeout(this.monitorTimeout);
      this.monitorTimeout = null;
      this._nvlaMonitorInstalled = false;
    }
  }

  get nvlaMonitorInstalled () {
    return this._nvlaMonitorInstalled;
  }

  set nvlaMonitorInstalled (value) {
    if (value == this._nvlaMonitorInstalled) return;
    this._nvlaMonitorInstalled = value;
    if (value == true && this._enabled) {
      this.log("NVLA Monitor detected", null, {color: 3});
      if (this.updateInterval != null) clearInterval(this.updateInterval);
      this.updateInterval = setInterval(this.update.bind(this), 1000);
    } else {
      if (this.updateInterval != null) clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  async update () {
    if (this.server.state.running && this.server.process != null && this.checkInProgress == false && this.nvlaMonitorInstalled == false) {
      this.checkInProgress = true;
      try {
        await this.checkServer();
      } catch (e) {
        if (e == "Timeout") {
          this.error("Failed to check server, server timed out " + this.checkTimeoutCount, null, {color: 4});
          this.checkTimeoutCount++;
          if (this.checkTimeoutCount >= this.server.config.maximumServerUnresponsiveTime/8) {
            this.error("Server is unresponsive, restarting", null, {color: 4});
            this.server.state.restarting = true;
            this.process.kill(9);
          }
        } else {
          this.error("Failed to check server, code: {e}", {e: e});
        }
      }
      this.checkCallback = null;
      this.checkTimeout = null;
      this.checkInProgress = false;
    }
  }

  /**
   * @param {{players: Array<string>, tps: number}} data 
   */
  onMonitorUpdate (data) {
    if (!this.server.state.running) return;
    if (this.nvlaMonitorInstalled == false) {
      this.nvlaMonitorInstalled = true;
      this.log("NVLA Monitor detected", null, {color: 3});
      if (this.checkTimeout != null) {
        clearTimeout(this.checkTimeout);
        this.checkTimeout = null;
      }
      if (this.checkCallback != null) {
        this.checkCallback();
        this.checkCallback = null;
      }
      this.checkInProgress = false;
    }
    this.server.state.players = data.players;
    this.server.state.tps = data.tps;
    if (this.server.state.idleMode) this.server.state.tps = null;
    clearTimeout(this.monitorTimeout);
    this.checkTimeoutCount = 0;
    this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.server.state.idleMode ? 60000*5 : 8000);
    return;
  }

  monitorUpdateTimeout () {
    if (!this.server.state.running) return;
    this.error("Failed to check server, NVLA Monitor timed out " + this.checkTimeoutCount, null, {color: 4});
    this.checkTimeoutCount++;
    if (this.checkTimeoutCount >= this.config.maximumServerUnresponsiveTime/8) {
      this.error("Server is unresponsive, restarting", null, {color: 4});
      this.server.state.restarting = true;
      this.process.kill(9);
    } else {
      clearTimeout(this.monitorTimeout);
      this.monitorTimeout = setTimeout(this.monitorUpdateTimeout.bind(this), this.server.state.idleMode ? 60000*5 : 8000);
    }
  }

  async checkServer() {
    if (this.server.process == null) return;
    return new Promise(function (resolve, reject) {
      this.checkCallback = resolve;
      this.checkTimeout = setTimeout(reject.bind(null, "Timeout"), 8000);
      this.server.command("list", true);
    }.bind(this));
  }
}

class StandardIOHandler {

  /** @type Net.Server */
  _socket;

  /** @type Server */
  server;

  /** @type Net.Socket */
  connectionToServer;

  /**
   * @param {Server} s 
   */
  constructor (s) {
    this.server = s;
    this.verbose = this.server.verbose.bind(this.server);
    this.log = this.server.log.bind(this.server);
    this.error = this.server.error.bind(this.server);
  }

  async handleStdout(data) {
    let d = data.toString().split("\n");
    for (let i in d)
      if (d[i].trim() != "") {
        var cleanup = false;
        if (d[i].indexOf("The referenced script") > -1 && d[i].indexOf("on this Behaviour") > -1 && d[i].indexOf("is missing!") > -1) cleanup = true;
        else if (d[i].indexOf("Filename:  Line: ") > -1) cleanup = true;
        else if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) cleanup = true;
        else if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) cleanup = true;
        else if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) cleanup = true;
        else if (d[i].indexOf("ERROR: Shader") > -1 || d[i].indexOf("WARNING: Shader") > -1) cleanup = true;
        if (cleanup == true && this.server.config.cleanLogs) continue;
        this.verbose(d[i], { logType: "sdtout", cleanup: cleanup }, { color: 8 });
      }
  }

  async handleStderr(data) {
    let d = data.toString().split("\n");
    for (let i in d) {
      if (d[i].trim() == "") continue;
      if (d[i].indexOf("////NVLAMONITORSTATS--->") > -1) {
        let data = d[i].replace("////NVLAMONITORSTATS--->", "");
        try {
          data = JSON.parse(data);
        } catch (e) {
          this.error("Failed to parse NVLA Monitor stats: {e}", { e: e });
          return;
        }
        this.server.serverMonitor.onMonitorUpdate(data);
        return;
      }
      this.error(d[i], { logType: "sdtout", cleanup: false }, { color: 8 });
    }
  }

  destroy () {
    try {
      this._socket.close();
    } catch {}
    this._socket = null;
  }
  
  handleServerEvent (code) {
    if (code == 16) {
      if (this.server.state.starting) {
        clearTimeout(this.server.timeout);
        this.server.timeout = null;
        this.log("Started Successfully");
        this.server.restartCount = 0;
        this.server.state.starting = false;
        this.server.state.running = true;
        this.server.state.uptime = Date.now();
        this.server.main.emit("serverReady", this);
        this.server.OnUpdate();
        if (this.server.startPromise.resolve != null) {
          this.server.startPromise.resolve();
          this.server.startPromise.resolve = null;
          this.server.startPromise.reject = null;
        }
      }
      if (this.server.main.config.clearLALogs) this.server.clearLALogs();
      this.server.state.roundStartTime = null;
    } else if (code == 21 || code == 20) {
      if (this.server.state.delayedRestart) this.server.state.delayedRestart = false;
      if (this.server.state.stopping && this.server.state.delayedStop) {
        this.server.state.delayedStop = false;
      }
      else if (this.server.state.stopping && !this.server.state.delayedStop) {
        this.server.state.delayedStop = false;
      }
      else {
        this.server.state.stopping = true;
        this.server.state.delayedStop = true;
      }
    } else if (code == 22) {
      if (this.server.state.delayedStop) this.server.state.delayedStop = false;
      if (this.server.state.restarting && this.server.state.delayedRestart) {
        this.server.state.delayedRestart = false;
      }
      else if (this.server.state.restarting && !this.server.state.delayedRestart) {
        this.server.state.delayedRestart = false;
      }
      else {
        this.server.state.restarting = true;
        this.server.state.delayedRestart = true;
      }
    } else if (code == 19) {
      if (this.server.state.delayedRestart) {
        this.server.state.delayedRestart = false;
        this.server.state.restarting = false;
      } else if (this.server.state.delayedStop) {
        this.server.state.stopping = false;
        this.server.state.delayedStop = false;
      }
    } else if (code == 17) {
      this.server.state.idleMode = true;
      this.server.state.players = [];
      this.server.state.tps = 0;
      if (this.server.serverMonitor.nvlaMonitorInstalled) {
        clearTimeout(this.server.serverMonitor.monitorTimeout);
        this.server.serverMonitor.monitorTimeout = setTimeout(this.server.serverMonitor.monitorUpdateTimeout.bind(this), 60000*5);  
      }
    } else if (code == 18) {
      this.server.state.idleMode = false;
      if (this.server.serverMonitor.nvlaMonitorInstalled) {
        clearTimeout(this.server.serverMonitor.monitorTimeout);
        this.server.serverMonitor.monitorTimeout = setTimeout(this.server.serverMonitor.monitorUpdateTimeout.bind(this), 8000);  
      }
    }
  }

  buffer

  handleServerMessage (chunk) {
    if (this.buffer != null) {
      chunk = Buffer.concat([this.buffer, chunk]);
      this.buffer = null;
    }
    let data = [...chunk]
    while (chunk.length > 0) {
      let control = chunk.readUInt8(0);
      if (control >= 16) {
        // handle control code
        if (events[control.toString()] != null) this.log("Event Fired: {codename}", {codename: events[control.toString()], code: control}, {color: 6});
        this.handleServerEvent(control);
        chunk = chunk.slice(1);
        continue;
      }
      if (chunk.length < 5) {
        this.buffer = chunk;
        return;
      }
      let length = chunk.readUInt32LE(1);
      if (chunk.length < 5+length) {
        this.buffer = chunk;
        return;
      }
      let m = chunk.slice(5, 5+length);
      chunk = chunk.slice(5+length);
      for (let i = 0; i < m.length; i++) message += String.fromCharCode(m[i])
        if (message.trim() == ("New round has been started.")) this.server.state.roundStartTime = new Date().getTime();
        if (this.server.serverMonitor.checkCallback != null && message.indexOf("List of players") > -1) {
          var players = message.substring(message.indexOf("List of players")+17, message.indexOf("List of players")+17+message.substring(message.indexOf("List of players")+17).indexOf(")"));
          players = parseInt(players);
          if (isNaN(players)) players = 0;
          let arr = [];
          for (let i = 0; i < players; i++) arr.push("Unknown");
          this.server.state.players = arr;
          this.server.tps = 0;
          this.server.serverMonitor.checkTimeoutCount = 0;
          clearTimeout(this.server.serverMonitor.checkTimeout);
          this.server.serverMonitor.checkTimeout = null;
          this.tempListOfPlayersCatcher = true;
          this.server.serverMonitor.checkCallback();
          return;
        }
        if (this.tempListOfPlayersCatcher) message = message.replaceAll("\n*\n", "*");
        if (this.tempListOfPlayersCatcher && message.indexOf(":") > -1 && (message.indexOf("@") > -1 || message.indexOf("(no User ID)")) && message.indexOf("[") > -1 && message.indexOf("]") > -1 && (message.indexOf("steam") > -1 || message.indexOf("discord") > -1 || message.indexOf("(no User ID)") > -1)) return;
        else if (this.tempListOfPlayersCatcher) delete this.tempListOfPlayersCatcher;
        if (message.charAt(0) == "\n") message = message.substring(1,message.length);
        if (message.indexOf("Welcome to") > -1 && message.length > 1000) message = colors[code]("Welcome to EXILED (ASCII Cleaned to save your logs)");
        this.server.main.vega.client.sendMessage(new mt.serverConsoleLog(this.server.config.id, message.replace(ansiStripRegex, "").trim(), code));
        this.log(message.trim(), { logType: "console" }, { color: code });
    }
  }

  handleServerConnection (connection) {
    if (connection.remoteAddress != "127.0.0.1" && connection.remoteAddress != "::ffff:127.0.0.1") {
      try {
        connection.end();
      } catch (e) {}
      return;
    }
    if (this.connectionToServer != null) {
      try {connection.end()} catch {}
      return;
    }
    this.log("Console Socket Connected");
    this.connectionToServer = connection;
    connection.on("data", this.handleServerMessage.bind(this));
    connection.on('end', this.onSocketEnd.bind(this));
    connection.on('error', this.onSocketErr.bind(this));
  }

  onSocketEnd () {
    this.log("Console Socket Disconnected", null, {color: 4});
    this._socket = null;
    this.connectionToServer = null;
  }

  onSocketErr (e) {
    try {
      this.socket.end();
    } catch (e) {}
    this.verbose("Console Socket Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}, {color: 4});
    this._socket = null;
    this.connectionToServer = null;
  }

  get socket () {
    if (this._socket == null || this._socket.listening == false) {
      return this.createSocket().then(s => this._socket = s);
    }
    return this._socket;
  }

  /**
     * @returns {Promise<Net.Server>}
     */
  createSocket() {
    return new Promise(function (resolve, reject) {
        let server = new Net.Server();
        server.on("connection", this.handleServerConnection.bind(this));
        server.on("error", (e) => this.onSocketErr(e) & reject(e));
        server.listen(0, function (s, resolve) { resolve(s);}.bind(this, server, resolve));
        setTimeout(function (reject) { reject("Socket took too long to open"); }.bind(null, reject),1000);
    }.bind(this));
  }
}

class Server {
  /** @type NVLA */
  main;

  ioHandler = new StandardIOHandler(this);
  
  serverMonitor = new ServerMonitor(this);
  
  /** @type serverState */
  state = new serverState(this);

  /** @type ServerConfig */
  config;

  /** @type boolean */
  installed = false;

  /** @type {import("child_process")["ChildProcess"]["prototype"]} */
  process;

  /** @type NVLA["logger"] */
  logger;

  timeout;

  /** @type string */
  lastRestart;

  restartCount = 0;

  /**
   * @param {NVLA} main
   * @param {ServerConfig} config
   */
  constructor(main, config, watchers = true) {
    this.main = main;
    this.logger = main.logger.child({ type: this });
    this.config = new ServerConfig(main, config);
    this.fileEventHandler = new FileEventHandler(this);

    this.log("Server local config folder: " + this.config.paths.serverContainer);
    try {
      if (!fs.existsSync(this.config.paths.pluginsFolderPath)) fs.mkdirSync(this.config.paths.pluginsFolderPath, { recursive: true });
      if (!fs.existsSync(this.config.paths.serverConfigsFolder)) fs.mkdirSync(this.config.paths.serverConfigsFolder, { recursive: true });
      if (!fs.existsSync(this.config.paths.globalDedicatedServerConfigFiles)) fs.mkdirSync(this.config.paths.globalDedicatedServerConfigFiles, { recursive: true });
      if (watchers) this.setupWatchers();
    } catch (e) {
      this.state.error = "Failed to create folders: " + e;
      this.error("Failed to create folders: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    let executable = fs.existsSync(path.join(this.config.paths.serverInstallFolder, "SCPSL.exe")) ? path.join(this.config.paths.serverInstallFolder, "SCPSL.exe") : fs.existsSync(path.join(this.config.paths.serverInstallFolder, "SCPSL.x86_64")) ? path.join(this.config.paths.serverInstallFolder, "SCPSL.x86_64") : null;
    if (executable != null) this.installed = true;
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

  /** @type {{resolve: Function, reject: Function}} */
  startPromise = {};

  async start() {
    if (this.process != null) return -1; //Server process already active
    if (this.state.starting) return -2; //Server is already starting
    if (this.state.installing) return -3; //Server is installing
    if (this.state.updating) return -4; //Server is updating
    if (this.state.configuring) return -5; //Server is configuring
    if (this.state.uninstalling) return -10; //Server is uninstalling
    if (this.main.stopped) return -11; //Prevent starting when NVLA is shutting down
    await this.main.memoryMonitor.checkMemory();
    if (this.main.memoryMonitor.lowMemory) {
      this.state.error = "System memory too low";
      return -11; //Machine memory is too low to start the server
    }
    this.log("Starting server {label}", {label: this.config.label});

    this.serverMonitor.enabled = true;
    this.fullReset();
    this.state.uptime = new Date().getTime();
    this.state.starting = false;
    this.state.transfering = false;
    this.state.restarting = false;
    this.state.error = null;

    let executable = fs.existsSync(path.join(this.config.paths.serverInstallFolder, "SCPSL.exe")) ? path.join(this.config.paths.serverInstallFolder, "SCPSL.exe") : fs.existsSync(path.join(this.config.paths.serverInstallFolder, "SCPSL.x86_64")) ? path.join(this.config.paths.serverInstallFolder, "SCPSL.x86_64") : null;
    if (executable == null) {
      this.state.error = "Failed to find executable";
      this.error("Failed to find executable");
      return -4;
    }
    let consolePort;
    try {
      await this.ioHandler.socket;
      const address = this.ioHandler.socket.address();
      consolePort = address.port;
      this.log("Console socket created on {port}", {port: consolePort});
    } catch (e) {
      this.state.error = "Failed to create console socket: " + e;
      this.error("Failed to create console socket: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return -3;
    }
    let cwd = path.parse(executable).dir;
    let base = path.parse(executable).base;
    if (typeof this.config.port != "number" || this.config.port < 1 || this.config.port > 65535) return -15; //Invalid port number supplied
    try {
      let target = (process.platform == "win32" ? "" : "./") + base;
      let args = ["-batchmode", "-nographics", "-nodedicateddelete", "-port" + this.config.port, "-console" + consolePort, "-id" + process.pid, "-appdatapath", path.relative(cwd, this.config.paths.serverContainer), "-vegaId " + this.config.id];
      this.log("Starting process: {cwd} {target}", {cwd: cwd, target: target, args: args});
      this.process = spawn(target, args, {cwd: cwd});
    } catch (e) {
      this.error("Failed to start server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.state.error = "Failed to start server: " + e;
      this.ioHandler.destroy();
      return -5;
    }
    this.state.starting = true;
    this.process.stdout.on("data", this.ioHandler.handleStdout.bind(this.ioHandler));
    this.process.stderr.on("data", this.ioHandler.handleStderr.bind(this.ioHandler));
    this.process.on("error", this.handleError.bind(this));
    this.process.on("exit", this.handleExit.bind(this));
    if (this.timeout != null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.timeout = setTimeout(this.startTimeout.bind(this), 1000*this.config.maximumStartupTime);
    let promise = new Promise(function (resolve, reject) {
      this.startPromise.resolve = resolve;
      this.startPromise.reject = reject;
    }.bind(this));
    return promise;
  }

  /** Ran when the server takes too long to start */
  async startTimeout () {
    this.error("{label} Startup took too long, stopped", {label: this.config.label});
    this.timeout = null;
    try {
      this.process.kill();
    } catch (e) {
      this.error("Failed killing server process {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    this.state.error = "Server startup took too long, check console";
  }

  stop(forced) {
    if (this.process == null) return -1; //Server process not active
    if ((this.state.stopping && !this.state.delayedStop) || (this.state.starting)) {
      this.log("Killing server {label}", {label: this.config.label}, {color: 6});
      if (this.state.starting == true) {
        this.state.starting = false;
        this.state.stopping = true;
      }
      this.process.kill(9);
    } else if (this.state.delayedStop || (!this.state.stopping && this.state.players != null && this.state.players.length <= 0) || forced) {
      this.log("Force Stopping server {label}", {label: this.config.label}, {color: 6});
      this.state.delayedStop = false;
      this.state.stopping = true;
      this.command("stop");
      if (this.timeout != null) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
      this.timeout = setTimeout(this.stopTimeout.bind(this), 1000*this.config.maximumShutdownTime);
      return;
    } else if (!this.state.stopping && this.state.players != null && this.state.players.length > 0) {
      this.log("Stopping server {label} Delayed", {label: this.config.label}, {color: 6});
      this.command("snr");
    }
  }

  /** Ran when the server takes too long to stop */
  async stopTimeout () {
    this.error("{label} Shutdown took too long, forcing", {label: this.config.label});
    this.timeout = null;
    this.process.kill();
  }

  restart(forced) {
    if (this.process == null) return this.start();
    if (this.state.stopping) return -2; //Server stopping
    if (this.state.starting) return -3; //Server restarting
    if (this.state.uninstalling) return -5; //Server uninstalling
    if (this.state.delayedStop) this.command("snr");
    if (this.state.delayedRestart || (!this.state.restarting && this.state.players != null && this.state.players.length <= 0) || forced) {
      this.log("Force Restarting server {label}", {label: this.config.label}, {color: 6});
      this.state.delayedRestart = false;
      this.state.restarting = true;
      this.command("softrestart");
      if (this.timeout != null) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
      this.timeout = setTimeout(this.restartTimeout.bind(this), 1000*this.config.maximumRestartTime);
      return;
    } else if (!this.state.restarting && this.state.players != null && this.state.players.length > 0 && this.timeout == null) {
      this.log("Restarting server {label} delayed", {label: this.config.label}, {color: 6});
      this.command("rnr");
      this.timeout = setTimeout(this.delayedRestartTimeout.bind(this), 2000);
    }
  }

  /** Ran when the server takes too long to restart */
  async restartTimeout () {
    this.error("{label} Restart took too long, forcing", {label: this.config.label});
    this.timeout = null;
    this.process.kill();
  }

  /** Ran when the server takes too long setting up delayed restart */
  async delayedRestartTimeout () {
    this.error("{label} Setting delayed restart took too long, the server may not be responding!", {label: this.config.label});
    this.timeout = null;
  }

  cancelAction () {
    //requires support for canceling installs and updates
    if (this.state.updating && this.main.steam.activeProcess != null && this.main.steam.cancel != true) {
      this.main.steam.cancel = true;
      //this.main.steam.activeProcess.kill(); //This is dangerous for some reason, avoid this cause it CAN crash node.js
    } else if (this.state.installing && this.main.steam.activeProcess != null && this.main.steam.cancel != true) {
      this.main.steam.cancel = true;
      //this.main.steam.activeProcess.kill(); //This is dangerous for some reason, avoid this cause it CAN crash node.js
    }
    if (this.process == null) return -1;
    if (this.state.delayedRestart) this.command("rnr");
    else if (this.state.delayedStop) this.command("snr");
  }

  async update(skipConfig) {
    if (this.state.updating || this.state.starting || this.state.uninstalling) return;
    this.state.error = null;
    this.state.updating = true;
    this.log("Updating server {label}", {label: this.config.label});
    try {
      let result = await this.main.steam.downloadApp("996560", path.normalize(this.config.paths.serverInstallFolder), this.config.beta, this.config.betaPassword, this.config.installArguments, this);
      this.state.percent = null;
      this.state.steam = null;
      if (result == -1) {
        this.state.updating = false;
        return;
      }
      if (result != 0) throw "Steam exit code invalid: " + result;
      this.log("Updated SCPSL", null, {color: 3});
    } catch (e) {
      this.state.error = "Failed to update server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to update server: ", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.state.updating = false;
      return;
    }
    try {
      if (!skipConfig) await this.configure();
    } catch (e) {
      this.state.error = "Failed to update server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.state.updating = false;
      return;
    }
    this.state.updating = false;
  }

  async install() {
    if (this.state.installing) return -1; // Already installing
    this.state.installing = true;
    this.log("Installing server {label}", {label: this.config.label});
    try {
      let result = await this.main.steam.downloadApp("996560", path.normalize(this.config.paths.serverInstallFolder), this.config.beta,  this.config.betaPassword, this.config.installArguments, this);
      this.state.percent = null;
      this.state.steam = null;
      if (result == -1) {
        this.state.installing = false;
        return -2;
      }
      if (result != 0) throw "Steam exit code invalid: " + result;
      this.log("Installed SCPSL", null, {color: 3});
      this.installed = true;
    } catch (e) {
      this.state.error = "Failed to install server: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to install server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      this.state.installing = false;
      return -2; // Failed to install
    }
    this.state.installing = false;
    let result = await this.configure();
    return result;
  }

  async configure() {
    while (this.state.configuring) await new Promise((resolve) => setTimeout(resolve, 250));
    this.state.configuring = true;
    this.log("Configuring server {label}", { label: this.config.label });
    if (this.state.uninstalling) return -10;
    try {
      await this.getPluginConfigFiles();
    } catch (e) {
      this.state.error = "Failed to get plugin configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugin configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      return -1; //Failed to get plugin configs
    }
    if (this.state.uninstalling) return -10;
    try {
      await this.getDependencies();
    } catch (e) {
      this.state.error = "Failed to get dependencies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dependencies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      return -2; //Failed to get dependencies
    }
    if (this.state.uninstalling) return -10;
    try {
      await this.getPlugins();
    } catch (e) {
      this.state.error = "Failed to get plugins: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugins: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      return -3; //Failed to get plugins
    }
    if (this.state.uninstalling) return -10;
    try {
      await this.getCustomAssemblies();
    } catch (e) {
      this.state.error = "Failed to get custom assemblies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      return -4; //Failed to get custom assemblies
    }
    if (this.state.uninstalling) return -10;
    try {
      await this.getDedicatedServerConfigFiles();
    } catch (e) {
      this.state.error = "Failed to get dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      return -5; //Failed to get dedicated server configs
    }
    if (this.state.uninstalling) return -10;
    try {
      await this.getGlobalDedicatedServerConfigFiles();
    } catch (e) {
      this.state.error = "Failed to get global dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get global dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
      this.state.configuring = false;
      return -6; //Failed to get global dedicated server configs
    }
    if (this.state.uninstalling) return -10;
    fs.writeFileSync(path.join(this.config.paths.serverInstallFolder, "hoster_policy.txt"), "gamedir_for_configs: true");
    this.state.configuring = false;
    if (this.config.autoStart && this.process == null) this.start().catch(() => {});
  }

  async uninstall() {
    if (this.state.uninstalling) return -1; // Already uninstalling
    this.state.uninstalling = true;
    this.disableWatching = true;
    this.log("Uninstalling server {label}", {label: this.config.label});
    await this.stopWatchers();
    while (this.state.configuring || this.state.installing) await new Promise(r => setTimeout(r, 200));
    if (this.process != null) {
      this.stop(true);
      this.log("Waiting for server stop");
      while (this.process != null) await new Promise(r => setTimeout(r, 200));
    }
    if (fs.existsSync(this.config.paths.serverContainer)) fs.rmSync(this.config.paths.serverContainer, { recursive: true, force: true });
    this.log("Uninstall complete");
    this.state.uninstalling = false;
  }

  command (command, nolog = false) {
    if (this.process == null || this.ioHandler.connectionToServer == null) return -1;
    command = command.trim();
    if (this.main.vega.connected && !nolog) this.main.vega.client.sendMessage(new mt.serverConsoleLog(this.config.id, "> "+command, 3));
    try {
      this.ioHandler.connectionToServer.write(Buffer.concat([toInt32(command.length), Buffer.from(command)]));
    } catch (e) {
      this.error("Console Socket Write Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}, {color: 4});
      return -2;
    }
  }

  async clearLALogs () {
    this.log("Clearing ServerLogs");
    let target = path.join(this.config.paths.serverInstallFolder, "AppData", "ServerLogs");
    if (!fs.existsSync(target)) return;
    try {
      fs.rmSync(target, {recursive: true, force: true});
    } catch (e) {
      this.error("Failed to clear ServerLogs\n{e}", {e: e});
    }
  }

  steamStateUpdate () {
    this.state.percent = this.main.steam.percentage;
    this.state.steam = this.main.steam.state;
  }

  async OnUpdate () {
    if (this.config.dailyRestarts && new Date().getHours() == this.config.restartTime.hour && new Date().getMinutes() == this.config.restartTime.minute) {
      let date = ((new Date().getMonth()) + "-" + (new Date().getDate()));
      if (this.lastRestart != date && this.process != null) {
        let value;
        if (this.state.restarting == false && this.state.delayedRestart == false) {
          try {
            value = await this.restart(false);
          } catch (e) {
            value = e;
          }
        }
        if (value != null) {
          this.lastRestart = date;
          this.error("Failed to restart server, code:{e}", {e: value});
        } else {
          this.log("Scheduled Restart in progress", null, {color: 6});
          this.lastRestart = date;
        }
      }
    }
  }

  fullReset () {
    this.ioHandler.destroy();
    this.process = null;
    this.state.players = null;
    this.state.tps = null;
    this.state.uptime = null;
    this.serverMonitor.nvlaMonitorInstalled = false;
    this.state.running = false;
    this.state.delayedRestart = false;
    this.state.delayedStop = false;
    this.state.updatePending = false;
    this.state.idleMode = false;
    this.state.memory = null;
    this.state.cpu = null;
    this.serverMonitor.checkInProgress = false;
    clearTimeout(this.serverMonitor.checkTimeout);
    this.serverMonitor.checkCallback = null;
    this.serverMonitor.checkTimeout = null;
    this.serverMonitor.checkTimeoutCount = 0;
  }

  async handleExit(code, signal) {
    this.log("Server Process Exited with {code} - {signal}", { code: code, signal: signal }, { color: 4 });
    this.serverMonitor.enabled = false;
    this.fullReset();
    if (this.timeout != null) {
        clearTimeout(this.timeout);
        this.timeout = null;
    }
    if (this.state.transfering && this.main.activeTransfers.has(this.config.id) && this.main.activeTransfers.get(this.config.id).direction == "source") {
        this.log("Server Transfering", null, { color: 2 });
        this.state.transfering = false;
        this.main.vega.client.sendMessage(new mt.sourceReady(this.config.id));
        this.uninstall();
        this.main.servers.delete(this.config.id);
        this.main.activeTransfers.delete(this.config.id);
        return;
    }
    this.state.transfering = false;
    if (this.state.stopping) {
      this.state.stopping = false;
      this.state.restarting = false;
      this.state.starting = false;
      return;
    }
    if (this.state.restarting) {
      if (this.main.stopped) return; //Prevent starting when NVLA is shutting down
      this.log("Server Restarting", null, { color: 2 });
      this.state.restarting = false;
      this.state.starting = false;
      this.start().catch(() => {});
      return;
    }
    if (this.state.starting) {
      this.error("Server Startup failed, Exited with {code} - {signal}", { code: code, signal: signal });
      if (this.state.error == null) this.state.error = "Server exited during startup, Exited with "+ code +" - "+signal;
      this.state.starting = false;
      if (this.restartCount < 3) {
        this.restartCount++;
        setTimeout(function () {this.start().catch(() => {});}.bind(this), 500);
        return;
      }
      this.restartCount = 0;
      if (this.startPromise.reject != null) {
        this.startPromise.reject("Startup failure: " +  code +" - "+signal);
        this.startPromise.reject = null;
        this.startPromise.resolve = null;
      }
      return;
    }
    this.error("Unexpected server death, Exited with {code} - {signal}", { code: code, signal: signal });
    this.start().catch(() => {});
  }

  async handleError(e) {
    this.error("Error launching server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    if (this.startPromise.reject != null) {
      this.startPromise.reject("Startup error: " + e.code);
      this.startPromise.reject = null;
      this.startPromise.resolve = null;
    }
  }





  /** @type import("chokidar")["FSWatcher"]["prototype"] */
  pluginsFolderWatch;

  /** @type import("chokidar")["FSWatcher"]["prototype"] */
  configFolderWatch;

  /** boolean */
  disableWatching = false;

  pluginLockfiles = new Map();

  configLockfiles = new Map();

  globalConfigLockfiles = new Map();

  /** @type FileEventHandler */
  fileEventHandler;

  async setupWatchers() {
    await this.stopWatchers();
    this.pluginsFolderWatch = chokidar.watch(this.config.paths.pluginsFolderPath, {ignoreInitial: true,persistent: true});
    this.pluginsFolderWatch.on("all", this.onPluginConfigFileEvent.bind(this));
    this.pluginsFolderWatch.on("error", e => this.error("Plugin Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
    this.configFolderWatch = chokidar.watch(this.config.paths.serverConfigsFolder, {ignoreInitial: true, persistent: true});
    this.configFolderWatch.on("all", this.onConfigFileEvent.bind(this));
    this.configFolderWatch.on("error", e => this.error("Config Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
    this.globalConfigFolderWatch = chokidar.watch(this.config.paths.globalDedicatedServerConfigFiles, {ignoreInitial: true, persistent: true});
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
    this.pluginsFolderWatch = chokidar.watch(this.config.paths.pluginsFolderPath, {ignoreInitial: true,persistent: true});
    this.pluginsFolderWatch.on("all", this.onPluginConfigFileEvent.bind(this));
    this.pluginsFolderWatch.on("error", e => this.error("Plugin Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
  }

  async resetServerConfigWatcher () {
    if (this.configFolderWatch != null) {
      await this.configFolderWatch.close();
      this.configFolderWatch = null;
    }
    this.configFolderWatch = chokidar.watch(this.config.paths.serverConfigsFolder, {ignoreInitial: true, persistent: true});
    this.configFolderWatch.on("all", this.onConfigFileEvent.bind(this));
    this.configFolderWatch.on("error", e => this.error("Config Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
  }

  async resetGlobalServerConfigWatcher () {
    if (this.globalConfigFolderWatch != null) {
      await this.globalConfigFolderWatch.close();
      this.globalConfigFolderWatch = null;
    }
    this.globalConfigFolderWatch = chokidar.watch(this.config.paths.globalDedicatedServerConfigFiles, {ignoreInitial: true, persistent: true});
    this.globalConfigFolderWatch.on("all", this.onGlobalConfigFileEvent.bind(this));
    this.globalConfigFolderWatch.on("error", e => this.error("Global Config Folder Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));
  }

  async onGlobalConfigFileEvent(event, filePath) {
    if (event == "addDir") return;
    this.fileEventHandler.registerEvent("globalServerConfig", event, filePath);
  }

  async onConfigFileEvent(event, filePath) {
    if (event == "addDir") return;
    this.fileEventHandler.registerEvent("serverConfig", event, filePath);
  }

  async onPluginConfigFileEvent(event, filePath) {
    if (event == "addDir") return;
    this.fileEventHandler.registerEvent("pluginConfig", event, filePath);
  }

  /** This queue puts a pause on file changes until after the server has finished starting up
   * @type Map<string,{type: string, event: string, filePath: string}> */
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
      targetFolder = this.config.paths.pluginsFolderPath;
      lockfiles = this.pluginLockfiles;
    } else if (type == "serverConfig") {
      targetFolder = this.config.paths.serverConfigsFolder;
      lockfiles = this.configLockfiles;
    } else if (type == "globalServerConfig") {
      targetFolder = this.config.paths.globalDedicatedServerConfigFiles;
      lockfiles = this.globalConfigLockfiles;
    }
    filePath = path.relative(targetFolder, filePath);
    try {
      if (isIgnored(targetFolder,path.join(targetFolder, filePath))) return;
    } catch (e) {
      this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    if (filePath.startsWith("dependencies") || filePath.endsWith(".dll")) return;
    if (lockfiles.has(filePath)) return lockfiles.delete(filePath);
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

  /**
   * @param {File} file
   */
  async procFile (type, file, targetFolder, lockFiles, shortName) {
    let filePath = path.join(targetFolder, joinPaths(file.path), file.name);
    try {
      if (fs.existsSync(filePath) && await loadMD5(filePath) == file.md5) {
        this.verbose("Up to date: {path}", { path: joinPaths(file.path) + path.sep + file.name });
        return;
      }
      try {
        if (!fs.existsSync(path.parse(filePath).dir)) fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.state.error = "Failed to create "+shortName+" directory: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to create "+shortName+" directory: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        return;
      }
      this.log("Writing ("+file.md5+"): {path}", { path: joinPaths(file.path) + path.sep + file.name });
      lockFiles.set(path.join(joinPaths(file.path), file.name), 1);
      await this.main.vega.downloadFile("configFile", type, file.name, this, file.path);
      if (this.state.uninstalling) return -10;
      let localmd5 = await loadMD5(filePath);
      if (localmd5 != file.md5) throw "MD5 mismatch: " + localmd5;
    } catch (e) {
      this.state.error = "Failed to write "+shortName+" file ("+file.name+"): " + e != null ? e.code || e.message || e : e;
      this.error("Failed to write "+shortName+" file ({name}): {e}\n{stack}", {name: file.name, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
  }

  async getConfigs (type) {
    let targetFolder;
    let names;
    let shortName;
    let usedFolders = [];
    let lockFiles;
    if (type == "pluginConfig") {
      targetFolder = this.config.paths.pluginsFolderPath;
      names = "Plugin Configs";
      shortName = "Plugin Config";
      usedFolders.push("dependencies");
      lockFiles = this.pluginLockfiles;
    } else if (type == "serverConfig") {
      targetFolder = this.config.paths.serverConfigsFolder;
      names = "Server Configs";
      shortName = "Server Config";
      lockFiles = this.configLockfiles;
    } else if (type == "globalServerConfig") {
      targetFolder = this.config.paths.globalDedicatedServerConfigFiles;
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
      this.state.error = "Failed to get "+names+": " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get {subType}: {e}", {subType: names, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    let processing = files.slice(0);
    let concurrent = 0;

    while (processing.length > 0) {
      let file = processing.shift();
      if (this.state.uninstalling) return -10;
      while (concurrent >= 20) await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent++;
      if (!usedFolders.includes(joinPaths(file.path))) usedFolders.push(joinPaths(file.path));
      this.procFile(type, file, targetFolder, lockFiles, shortName).catch((e) => {
        this.state.error = "Failed to write "+shortName+" file ("+file.name+"): " + e != null ? e.code || e.message || e : e;
        this.error("Failed to write "+shortName+" file ({name}): {e}\n{stack}", {name: file.name, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      }).finally(() => concurrent--);
    }
    while (concurrent > 0) await new Promise((resolve) => setTimeout(resolve, 10));
    if (this.state.uninstalling) return -10;
    /** @type Array<> */
    var currentFiles = readFolder(targetFolder, null, true);
    let folders = currentFiles.filter((x) => x.isDir);
    currentFiles = currentFiles.filter((x) => !x.isDir);
    for (let i in currentFiles) {
      if (this.state.uninstalling) return -10;
      let file = currentFiles[i];
      let safe = false;
      for (let x in files) {
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
            //lockFiles.set(path.join(joinPaths(file.p) || "", file.filename), 1);
            fs.rmSync(path.join(targetFolder, joinPaths(file.p) || "", file.filename), { recursive: true });
          }
        } catch (e) {
          this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        }
      } catch (e) {
        this.state.error = "Failed to delete unneeded "+shortName+" file: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to delete unneeded "+shortName+" file: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        continue;
      }
    }
    let filtered = [];
    for (let i in usedFolders) {
      if (this.state.uninstalling) return -10;
      var p = usedFolders[i];
      while (p != "") {
        if (p.trim() != "" && !filtered.includes(p)) filtered.push(p);
        p = path.parse(p).dir;
      }
    }
    usedFolders = filtered;
    for (let i in folders) {
      if (this.state.uninstalling) return -10;
      try {
        if (isIgnored(targetFolder, path.join(targetFolder, joinPaths(folders[i].p) || "", folders[i].filename))) continue;
      } catch (e) {
        this.error("Failed to check if file is ignored: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      }
      if (usedFolders.includes(path.join(path.normalize(joinPaths(folders[i].p)), folders[i].filename))) continue;
      this.log("Deleting: {path}", {path: path.join(joinPaths(folders[i].p) || "", folders[i].filename)});
      try {
        fs.rmSync(path.join(targetFolder, joinPaths(folders[i].p) || "", folders[i].filename), { recursive: true });
      } catch (e) {
        this.state.error = "Failed to delete unneeded "+shortName+" folder: " + e != null ? e.code || e.message || e : e;
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
   */
  async getConfig (type, file) {
    while (this.getConfigInProgress) await new Promise((resolve) => setTimeout(resolve, 200));
    if (this.state.uninstalling) return -10;
    this.getConfigInProgress = true;
    let targetFolder;
    let shortName;
    let usedFolders = [];
    let lockFiles;
    try {
      if (type == "pluginConfig") {
        targetFolder = this.config.paths.pluginsFolderPath;
        shortName = "Plugin Config";
        usedFolders.push("dependencies");
        lockFiles = this.pluginLockfiles;
      } else if (type == "serverConfig") {
        targetFolder = this.config.paths.serverConfigsFolder;
        shortName = "Server Config";
        lockFiles = this.configLockfiles;
      } else if (type == "globalServerConfig") {
        targetFolder = this.config.paths.globalDedicatedServerConfigFiles;
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
      if (fs.existsSync(filePath) && await loadMD5(filePath) == file.md5) {
        this.verbose("Up to date: {path}", { path: joinPaths(file.path) + path.sep + file.name });
        this.getConfigInProgress = false;
        return;
      }
      try {
        if (!fs.existsSync(path.parse(filePath).dir)) fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.state.error = "Failed to create "+shortName+" directory: " + e != null ? e.code || e.message || e : e;
        this.error("Failed to create "+shortName+" directory: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
        return;
      }
      this.log("Writing ("+file.md5+"): {path}", { path: joinPaths(file.path) + path.sep + file.name });
      lockFiles.set(path.join(joinPaths(file.path), file.name), 1);
      await this.main.vega.downloadFile("configFile", type, file.name, this, file.path);
      if (await loadMD5(filePath) != file.md5) {
        await this.getConfig(type, file);
        throw "MD5 mismatch";
      }
    } catch (e) {
      this.state.error = "Failed to write "+shortName+" file ("+file.name+"): " + e != null ? e.code || e.message || e : e;
      this.error("Failed to write "+shortName+" file ({name}): {e}\n{stack}", {name: file.name, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
    this.getConfigInProgress = false;
  }

  getPluginConfigFilesInProg = false;
  getDedicatedServerConfigFilesInProg = false;
  getGlobalDedicatedServerConfigFilesInProg = false;

  async getPluginConfigFiles() {
    if (this.getPluginConfigFilesInProg) while (this.getPluginConfigFilesInProg) await new Promise((resolve) => setTimeout(resolve, 100));
    this.getPluginConfigFilesInProg = true;
    try {
      await this.getConfigs.bind(this)("pluginConfig");
    } catch (e) {
      this.state.error = "Failed to get plugin configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugin configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getPluginConfigFilesInProg = false;
  }

  async getDedicatedServerConfigFiles() {
    if (this.getDedicatedServerConfigFilesInProg) while (this.getDedicatedServerConfigFilesInProg) await new Promise((resolve) => setTimeout(resolve, 100));
    this.getDedicatedServerConfigFilesInProg = true;
    try {
      await this.getConfigs.bind(this)("serverConfig");
    } catch (e) {
      this.state.error = "Failed to get dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getDedicatedServerConfigFilesInProg = false;
  }

  async getGlobalDedicatedServerConfigFiles() {
    if (this.getGlobalDedicatedServerConfigFilesInProg) while (this.getGlobalDedicatedServerConfigFilesInProg) await new Promise((resolve) => setTimeout(resolve, 100));
    this.getGlobalDedicatedServerConfigFilesInProg = true;
    try {
      await this.getConfigs.bind(this)("globalServerConfig");
    } catch (e) {
      this.state.error = "Failed to get global dedicated server configs: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get global dedicated server configs: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getGlobalDedicatedServerConfigFilesInProg = false;
  }

  async grabAssemblies (type) {
    let data;
    let targetFolder
    let names;
    let shortName;
    let ignoreExisting = false;
    if (type == "dependency") {
      targetFolder = path.join(this.config.paths.pluginsFolderPath, "dependencies");
      names = "Dependencies";
      shortName = "Dependency";
    } else if (type == "plugin") {
      targetFolder = this.config.paths.pluginsFolderPath;
      names = "Plugins";
      shortName = "Plugin";
    } else if (type == "customAssembly") {
      targetFolder = this.config.paths.serverCustomAssembliesFolder;
      names = "Custom Assemblies";
      shortName = "Custom Assembly";
      ignoreExisting = true;
    }
    try {
      data = await this.main.vega.getAssemblies(type, this.config.id);
    } catch (e) {
      this.state.error = "Failed to get "+names+": " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get {subType}: {e}", {subType: names, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
      return;
    }
    /** @type Map<string, import("./classes")["FileInfo"]["prototype"]> */
    let expected = new Map();
    for (let i in data) {
      if (this.state.uninstalling) return -10;
      let assembly = data[i];
      expected.set(assembly.name, assembly);
    }
    if (this.state.uninstalling) return -10;
    let found = [];
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, {recursive: true});
    let files = fs.readdirSync(targetFolder);
    for (let i in files) {
      if (this.state.uninstalling) return -10;
      let file = files[i];
      let stats = fs.statSync(path.join(targetFolder, file));
      if (!stats.isFile()) continue;
      let name = file.replace(".dll", "");
      if (file.endsWith(".dll") && !expected.has(name) && !ignoreExisting) {
        this.log("Deleting: {file}", {file: file});
        try {
          fs.rmSync(path.join(targetFolder, file), {recursive: true});
        } catch (e) {
          this.state.error = "Failed to delete unneeded "+shortName+": " + e != null ? e.code || e.message || e : e;
          this.error("Failed to delete unneeded "+shortName+": {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
          continue;
        }
      } else if (file.endsWith(".dll") && expected.has(name)) {
        let md5;
        try {
          md5 = await loadMD5(path.join(targetFolder, file));
        } catch (e) {
          this.state.error = "Failed to get "+shortName+" MD5: " + e != null ? e.code || e.message || e : e;
          this.error("Failed to get "+shortName+" MD5: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e, path: path.join(targetFolder, file)});
          continue;
        }
        if (expected.get(name).md5 == md5) found.push(name);
      }
    }
    if (this.state.uninstalling) return -10;
    for (let i in data) {
      if (this.state.uninstalling) return -10;
      let assembly = data[i];
      if (!found.includes(assembly.name)) {
        this.log("Updating: {assName}", {assName: assembly.name, subtype: type});
        try {
          await this.main.vega.downloadFile("assemblies", type, assembly.name, this, null);
        } catch (e) {
          this.state.error = "Failed to download "+shortName+" '"+assembly.name+"': " + e != null ? e.code || e.message || e : e;
          this.error("Failed to download "+shortName+" '{name}': {e}", {name: assembly.name, e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
          continue;
        }
      } else {
        this.verbose(shortName+" up to date: {assName}", {assName: assembly.name, subtype: type});
      }
    }
    this.log("Installed "+names, null, {color: 6});
  }

  getPluginsInProg = false;
  getCustomAssembliesInProg = false;
  getDependenciesInProg = false;

  async getPlugins() {
    if (this.getPluginsInProg) while (this.getPluginsInProg) await new Promise((resolve) => setTimeout(resolve, 100));
    this.getPluginsInProg = true;
    try {
      await this.grabAssemblies.bind(this)("plugin");
    } catch (e) {
      this.state.error = "Failed to get plugins: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get plugins: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getPluginsInProg = false;
  }

  async getCustomAssemblies() {
    if (this.getCustomAssembliesInProg) while (this.getCustomAssembliesInProg) await new Promise((resolve) => setTimeout(resolve, 100));
    this.getCustomAssembliesInProg = true;
    try {
      await this.grabAssemblies.bind(this)("customAssembly");
    } catch (e) {
      this.state.error = "Failed to get custom assemblies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get custom assemblies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getCustomAssembliesInProg = false;
  }

  async getDependencies() {
    if (this.getDependenciesInProg) while (this.getDependenciesInProg) await new Promise((resolve) => setTimeout(resolve, 100));
    this.getDependenciesInProg = true;
    try {
      await this.grabAssemblies.bind(this)("dependency");
    } catch (e) {
      this.state.error = "Failed to get dependencies: " + e != null ? e.code || e.message || e : e;
      this.error("Failed to get dependencies: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.getDependenciesInProg = false;
  }
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

  successOverride = false;

  constructor(nvla) {
    super();
    this.main = nvla;
    this.logger = this.main.logger.child({ type: "steam" });
    this.log("Checking steam", null, { color: 3 });
    var basePath = defaultSteamPath;
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
   * @param {string} runId
   * @param {string} str
   * @param {boolean} isError
   */
  async onstdout(runId, str, isError) {
    this.emit("log", new steamLogEvent(runId, str, isError));
    try {
      if (str.trim() == "") return;
      if (str.indexOf("Success! App") > -1 && str.indexOf("fully installed") > -1) {
        this.successOverride = true;
        return;
      }
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
    this.successOverride = false;
    this.verbose("Steam binary path: {path}", { path: this.binaryPath }, { color: 6 });
    
    let env = process.platform == "linux" ? Object.assign(process.env, { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH != null ? path.parse(this.binaryPath).dir + ":" + process.env.LD_LIBRARY_PATH : path.parse(this.binaryPath).dir }) : process.env;
    let cwd = process.platform == "linux" ? path.parse(path.join(this.binaryPath, "../")).dir : path.parse(this.binaryPath).dir;

    let spawnString = process.platform === "win32" ? "powershell.exe" : "bash";
    this.verbose("Spawning: {spawnString}", { spawnString: spawnString }, { color: 6 });
    this.activeProcess = pty.spawn(spawnString, [], {cwd: cwd, env: env});
    let proc = this.activeProcess;

    let cmd = path.relative(cwd, this.binaryPath);

    this.verbose("Running: {cmd} {params}", { cmd: cmd, params: params.join(" ") }, { color: 6 });
    
    proc.write((process.platform == "darwin" ? this.binaryPath : "./"+cmd) + " " + params.join(" ") + "\r");
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
      function (resolve) {
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
      if (this.successOverride == true) {
        this.log("Steam execution failed, but success override was triggered, continuing", null, { color: 3 });
        return 0;
      }
      return code;
    }
  }

  /**
   * Runs a steamcmd command immedately or puts it in the queue
   * @param {Array<string>} params
   * @param {string} runId
   * @param {Server} server
   */
  async runWrapper(params, runId, server) {
    while (this.inUse)
      await new Promise(
        function (resolve) {
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
      server.state.steam = null;
      server.state.percent = null;
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
    this.log("Checking steam binary", null, { color: 3 });
    let result = await this.runWrapper(["+login anonymous", "+quit"], 0);
    if (result == 0) this.ready = true;
    return result;
  }

  /**
   * @param {string} appId 
   * @param {string} path 
   * @param {string} beta 
   * @param {string} betaPassword 
   * @param {Array<string>} customArgs 
   * @param {Server} server 
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
      } catch (e) {
        this.error("Failed extraction: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
        return -2;
      }
    }
    return 1;
  }
}
module.exports.steam = steam;

class serverTransfer {
  /** @type string */
  transferId;

  /** @type ServerConfig */
  config;

  /** @type Server */
  server;

  /** @type NVLA */
  main;

  /** 'target' or 'source'
   * @type string */
  direction;

  /** @type string */
  _state;

  get state () {
    return this._state;
  }

  set state (v) {
    if (v == this._state) return;
    this._state = v;
    if (this.main.vega.connected) this.main.vega.client.sendMessage(new mt.transferStateUpdate({key: "transferState", value: v, server: this.server}));
  }

  /**
   * Process:
   * Target and current machine informed
   * Target machine installs server and starts it
   * Target machine spins down server after verifying sucessful start
   * Target informs vega server is ready
   * Vega informs current machine to send restart command to server
   * When current machine server restarts, it cancels the restart and informs vega the server is stopped
   * Vega will then tell the current machine to delete that server and tell the target machine to spin up the server, vega will also update the servers assigned machine ID
   * When target machine gets spinup request it will register the server in its servers map and start the server
   * @param {ServerConfig} config
   * @param {import("./index")["init"]["prototype"]} main 
   */
  constructor (config, main, direction) {
      this.main = main;
      this.main.log("Starting transfer of server {server} {direction}", {server: config.label, direction: direction}, { color: 5 });
      this.transferId = config.id;
      this.config = config;
      this.direction = direction;
      if (direction == "target" && this.main.servers.has(config.id)) {
        this.cancel("Server already exists");
        return -1;
      }
      if (this.main.activeTransfers.has(this.transferId)) {
        this.cancel("Transfer already in progress");
        return -1;
      }
      if (direction == "target") this.server = new Server(main, config, false);
      else this.server = main.servers.get(config.id);
      if (this.server == null) {
        this.cancel("Server not found");
        return -1;
      }
      if (direction == "target") this.install();
      else if (this.server.process != null) this.readySource();
      else {
        this.cancel("Source server not running");
        return -1;
      }
      this.main.activeTransfers.set(this.transferId, this);
  }

  //Called by source, when source is prepared
  async readySource () {
    this.main.log("Waiting for target server to be ready", null, { color: 5 });
    this.state = "Installing";
    this.server.state.transfering = true;
  }

  //Called by source, when target is ready
  async targetReady () {
    this.main.log("Target server is ready", null, { color: 5 });
    this.state = "Waiting";
    try {
      if (this.server.state.restarting == false && this.server.state.delayedRestart == false) this.server.restart();
    } catch (e) {
        this.error("Failed restart server for transfer: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
    }
  }

  //Called by target, when source is ready
  async sourceReady () {
    this.main.log("Source server is ready", null, { color: 5 });
    this.state = null;
    this.main.servers.set(this.server.config.id, this.server);
    this.server.start().catch(() => {});
    this.server.setupWatchers();
    this.main.activeTransfers.delete(this.transferId);
  }

  //Called by target, when target is preparing
  async install () {
    this.state = "Installing";
    let savedValue = this.server.config.autoStart;
    this.server.config.autoStart = false;
    let result;
    try {
      result = await this.server.install();
    } catch (e) {
      this.cancel(e.message);
      return;
    }
    if (result != null) {
      this.cancel("Failed to install server");
      return;
    }
    this.server.config.autoStart = savedValue;
    if (this.state == "Cancelled") return;
    this.state = "Starting";
    try {
      result = await this.server.start();
    } catch (e) {
      this.cancel("Failed to start server");
      return;
    }
    if (result != null) {
      this.cancel("Failed to start server");
      return;
    }
    if (this.state == "Cancelled") return;
    //Server should have started at this point, wait for it to stop;
    this.state = "Stopping";
    this.server.stop(true);
    this.server.stop(true); //kill
    while (this.server.process != null) await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.state == "Cancelled") return;
    this.state = "Waiting";
    this.main.log("Server {server} ready for transfer", {server: this.server.config.label}, { color: 5 });
    //Ready
    this.main.vega.client.sendMessage(new mt.transferTargetReady(this.transferId));
  }

  //Called by any, when transfer is cancelled locally
  cancel(reason) {
    if (this.state == "Cancelled") return;
    this.main.log("Transfer cancelled: {reason}", { reason: reason }, { color: 5 });
    this.state = "Cancelled";
    this.main.activeTransfers.delete(this.transferId);
    if (this.main.vega != null && this.main.vega.connected) this.main.vega.client.sendMessage(new mt.cancelTransfer(this.transferId, reason));
    try {
        if (this.direction == "target") {
            this.server.cancelAction();
            this.server.uninstall();
        } else {
            this.server.state.transfering = false;
        }
    } catch (e) {}
  }
}

class addresses {
  _public;
  
  get public () {
    return this._public;
  }

  set public (v) {
    if (this._public == v) return;
    this._public = v;
    this.main.emit("updateMachineState", {key: "network", subKey: "public", value: v});
  }

  /** @type Array<String> */
  _local = [];

  get local () {
    return this._local;
  }

  set local(v) {
    if (Array.isArray(v) && Array.isArray(this._local) && v.length == this._local.length && this._local.filter(e => !v.includes(e)).length == 0 && v.filter(e => !this._local.includes(e)) == 0) return;
    this._local = v;
    this.main.emit("updateMachineState", {key: "network", subKey: "local", value: v});
  }

  /** @type number */
  _port;

  get port () {
    return this._port;
  }

  set port (v) {
    if (this._port == v) return;
    this._port = v;
    this.main.emit("updateMachineState", {key: "network", subKey: "port", value: v});
  }

  /** @type NVLA */
  main;

  interval;

  constructor (main) {
      this.main = main;
      this.public = null;
      this.local = [];
      this.interval = setInterval(this.populate.bind(this), 1000);
      this.populate();
  }

  async populate () {
      const nets = os.networkInterfaces();
      let addresses = [];
      this.port = this.main.config.echoServerPort;
      for (let i in nets) {
          let intf = nets[i];
          for (let x in intf) {
            let net = intf[x];
            const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
            if (net.family === familyV4Value && !net.internal && !addresses.includes(net.address)) addresses.push(net.address);
          }
      }
      this.local = addresses;
      try {
        let response = await axios({
              method: "get",
              url: 'https://api.ipify.org/',
              timeout: 10000
          });
          if (response.data == null || typeof response.data != "string" || response.data.trim() == "") return false;
          this.public = response.data;
          return true;
      } catch {
          return false;
      }
  }

  toObject () {
    return {
      port: this.port,
      local: this.local.filter(() => true),
      public: this.public
    };
  }
}

class MemoryMonitor {
  /** @type NVLA */
  main;

  interval;

  logger;

  constructor (m){
    this.main = m;
    this.interval = setInterval(this.checkMemory.bind(this), 250);
    this.logger = this.main.logger.child({ type: "Memory Monitor" });
    this.checkMemory();
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

  minimumThreashPrompt = false;

  criticalThreashPrompt = false;

  /** @type boolean */
  _lowMemory = false;

  get lowMemory () {
    return this._lowMemory;
  }

  set lowMemory (v) {
    if (this._lowMemory == v) return;
    this._lowMemory = v;
    this.main.emit("updateMachineState", {key: "lowMemory", subKey: null, value: v});
  }

  /** @type number */
  _totalMemory;

  get totalMemory () {
    return this._totalMemory;
  }

  set totalMemory (v) {
    if (this._totalMemory == v) return;
    this._totalMemory = v;
    this.main.emit("updateMachineState", {key: "totalMemory", subKey: null, value: v});
  }

  /** @type number */
  _memory;

  get memory () {
    return this._memory;
  }

  set memory (v) {
    if (this._memory == v) return;
    this._memory = v;
    this.main.emit("updateMachineState", {key: "memory", subKey: null, value: v});
  }

  async checkMemory () {
    //If system has less than or equal to 100MB of free memory, investigate
    let currentFree = os.freemem();
    let total = osAlt.totalmem();
    this.totalMemory = total*1000000;
    this.memory = (total-osAlt.freemem())*1000000;
    if (currentFree < this.main.config.minimumMemoryThreashold && currentFree > this.main.config.criticalMemoryThreashold) {
      if (this.minimumThreashPrompt == false) {
        this.minimumThreashPrompt = true;
        this.log("Warning system memory is below minimum threashold: {formatedBytes}", {bytes: currentFree, formatedBytes: formatBytes(currentFree)});
      }
      var s = [];
      this.main.servers.forEach(server => {
        if (server.process != null && server.state.memory != null) {
          s.push({uid: server.config.id, bytes: server.state.memory, used: Math.round(server.state.memory/(os.totalmem()-currentFree)*100)});
        }
      });
      s.sort(function (a,b){return b.bytes-a.bytes});
      if (s.length > 0) {
        for (let i in s) {
          let server = this.main.servers.get(s[i].uid);
          if (server.state.delayedRestart == false && server.state.restarting == false && server.state.stopping == false && server.state.delayedStop == false && server.state.starting == false) {
            this.log("Restarting server {label} in attempt to save memory! - {formatedBytes}", {label: server.config.label, serverId: server.config.id, bytes: s[i].bytes, formatedBytes: formatBytes(s[i].bytes)});
            let result = await server.restart(false);
            if (typeof result == "number") this.main.error("Failed to restart server: {result}", {result: result});
            else break;
          } else break;
        }
      }
    } else if (currentFree < this.main.config.criticalMemoryThreashold) {
      if (this.criticalThreashPrompt == false) {
        this.criticalThreashPrompt = true;
        this.log("Warning system memory is below CRITCAL threashold: {formatedBytes}", {bytes: currentFree, formatedBytes: formatBytes(currentFree)});
      }
      this.lowMemory = true;
      s = [];
      this.main.servers.forEach(server => {
        if (server.process != null && server.state.memory != null) {
          s.push({uid: server.config.id, bytes: server.state.memory, used: Math.round(server.state.memory/(os.totalmem()-currentFree)*100)});
        }
      });
      s.sort(function (a,b){return b.bytes-a.bytes});
      if (s.length > 0) {
        for (let i in s) {
          let server = this.main.servers.get(s[i].uid);
          if (server.state.starting == false && server.state.restarting == false && server.state.stopping == false) {
            this.log("Force Restarting server {label} in attempt to save memory! - {formatedBytes}", {label: server.config.label, serverId: server.config.id, bytes: s[i].bytes, formatedBytes: formatBytes(s[i].bytes)});
            let result = await server.restart(true);
            if (typeof result == "number") this.main.error("Failed to restart server: {result}", {result: result});
            else break;
          } else if (server.process != null && (server.state.restarting == true || server.state.stopping == true || server.state.starting) && currentFree < 25000000) {
            this.log("Killing server {label} in attempt to save memory! - {formatedBytes}", {label: server.config.label, serverId: server.config.id, bytes: s[i].bytes, formatedBytes: formatBytes(s[i].bytes)});
            try {
              if (server.state.restarting == false && server.state.delayedRestart == false) server.state.stopping = true;
              server.process.kill();
            } catch {} //Ignore failures
            break;
          } else break;
        }
      }
    } else {
      //No memory issues detected
      if (this.lowMemory == true) this.lowMemory = false;
      if (this.minimumThreashPrompt == true) this.minimumThreashPrompt = false;
      if (this.criticalThreashPrompt == true) this.criticalThreashPrompt = false;
    }
  }
}

class ObservableMapSetEvent extends Event {
  constructor(observable, key, value) {
      super('set');
      this.observable = observable;
      this.key = key;
      this.value = value;
  }
}

class ObservableMapDeleteEvent extends Event {
  constructor(observable, key, value) {
      super('delete');
      this.observable = observable;
      this.key = key;
      this.value = value;
  }
}

class ObservableMap extends Map {
  constructor(iterable) {
    super(iterable);
    this._eventTarget = new EventTarget();
  }

  on(name, listener, options) {
    this._eventTarget.addEventListener(name, listener, options);
  }

  delete(key) {
    let v = this.get(key);
    super.delete(key);
    this._eventTarget.dispatchEvent(new ObservableMapDeleteEvent(this, key, v));
  }

  set(key, value) {
    if (this.get(key) == value) return;
    this._eventTarget.dispatchEvent(new ObservableMapSetEvent(this, key, value));
    super.set(key, value);
  }
}

class Rebalancer {
  /** @type NVLA */
  main;

  logger;

  cpuBalancingSupported;

  cpuRebalanceInProg = false;

  constructor (m){
    this.main = m;
    this.logger = this.main.logger.child({ type: "CPU Balancer" });

    if (this.main.config.cpuBalance) {
      this.log("CPU balancing is enabled, checking taskset");
      this.checkTaskSet().then(this.OnReady.bind(this));
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

  async OnReady () {
    if (this.cpuBalancingSupported) {
      this.main.on("serverReady", this.rebalanceServers.bind(this));
    }
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

  async rebalanceServers () {
    if (!this.main.config.cpuBalance) return;
    while (this.cpuRebalanceInProg) await new Promise(r => setTimeout(r, 500));
    this.cpuRebalanceInProg = true;
    let currentCount = 0;
    let primeCpus = new Map();
    for (let y = 0; y < availableCpus; y++) primeCpus.set(y, 0);
    for (var entry of this.main.servers.entries()) {
        var server = entry[1];
        if (!server.state.running || server.process == null || server.process.pid == null) continue;
        let cpus = [];
        for (let x = 0; x < this.main.config.cpusPerServer; x++) {
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

  async resetServerBalance () {
    while (this.cpuRebalanceInProg) await new Promise(r => setTimeout(r, 500));
    this.cpuRebalanceInProg = true;
    for (var entry of this.main.servers.entries()) {
        var server = entry[1];
        if (!server.state.running || server.process == null || server.process.pid == null) continue;
        let cpus = [];
        for (let x = 0; x < availableCpus; x++) cpus.push(x);
        let commands = [];
        try {
            commands.push("taskset -a -p " + convertToMask(cpus) + " " + server.process.pid);
        } catch (e) {
          this.error("Failed generating mask for: {main} {server}\n{e}", { main: cpus, server: server != null ? server.config.label : "null", e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
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
}

class NVLA extends EventEmitter {
  config = new settings(this);
  logger = this.createLogger();
  steam = new steam(this);
  vega = new Vega(this);
  seq = new winstonLoggerSeq(this, this.config.seq);
  loki = new winstonLoggerLoki(this, this.config.loki);
  echoServer = new EchoServer(this);
  network = new addresses(this);
  memoryMonitor = new MemoryMonitor(this);
  balancer = new Rebalancer(this);

  /** @type Map<String,Server> */
  servers = new ObservableMap();

  /** @type Map<String,serverTransfer> */
  activeTransfers = new Map();

  /** @type boolean */
  updateInProgress = false;

  /** @type number */
  _cpu;

  get cpu () {
    return this._cpu;
  }

  set cpu (v) {
    if (this._cpu == v) return;
    this._cpu = v;
    this.emit("updateMachineState", {key: "cpu", subKey: null, value: v});
  }

  /** @type boolean */
  stopped = false;

  daemonMode = false;

  /** @type Function */
  restart;

  /** @type Function */
  shutdown;
  
  verkeyWatch;

  updateInterval;

  uptime = Date.now();

  constructor() {
    super();

    this.servers.on("set", (d) => this.vega.connected ? this.vega.client.sendMessage(new mt.fullServerInfo(d.value)) : null);
    this.servers.on("delete", (d) => this.vega.connected ? this.vega.client.sendMessage(new mt.serverRemoved(d.value)) : null);

    this.verkeyWatch = chokidar.watch(path.parse(verkeyPath).dir, {ignoreInitial: true,persistent: true});
    this.verkeyWatch.on("all", this.userSCPSLAppdateUpdate.bind(this));
    this.verkeyWatch.on("error", e => this.error("Verkey file Watch Error: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e}));

    this.updateInterval = setInterval(this.update.bind(this), 1000);
    this.update();
  }

  async start(daemon = false) {
    try {
      if (this.config.seq.enabled) await this.seq.start();
      if (this.config.loki.enabled) await this.loki.start();
    } catch (e) {
      this.error("Failed to start winston loggers: {e}", { e: e != null ? e != null ? e.code || e.message || e : e : e, stack: e != null ? e.stack : e});
    }
    this.daemonMode = daemon;
    this.log("Welcome to "+chalk.green("NotVeryLocalAdmin")+" v"+pack.version+" By "+chalk.cyan(pack.author)+", console is ready" + (this.daemonMode ? " (Daemon Mode)" : ""));
    this.stopped = false;
    var serversPath = defaultServersPath;
    if (Array.isArray(serversPath)) serversPath = joinPaths(serversPath);
    if (!fs.existsSync(serversPath)) fs.mkdirSync(serversPath, { recursive: true });
    if (!process.argv.includes("-skipsteam")) {
      let check = await this.steam.check();
      if (this.steam.found != true || (typeof check == "number" && check != 0) || !this.steam.ready) {
        this.error("Steam check failed: {e}", { e: check });
        process.exit();
      }
    }
    this.log("Steam ready", null, { color: "blue" });
    this.vega.connect();
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
      this.config.saveConfg();
    } else if (event == "unlink") {
      this.config.verkey = null;
      this.config.saveConfg();
    }
    if (this.vega != null && this.vega.connected) this.vega.client.sendMessage(new mt.machineVerkeyUpdate(this.config.verkey));
    this.log("Verkey file event: {event} {filePath}", { event: event, filePath: filePath }, { color: 6 });
  }

  createLogger () {
    let transports = [
      new winston.transports.Console({
        level: this.config.level,
        format: winston.format.printf(function (info) {
          processPrintF(info);
          if (info.level == "error") info.message = chalk.red(info.message);
          return info.message;
        }.bind(this)),
      }),
    ];

    if (this.config.logSettings.enabled) transports.push(this.createRotatedLogTransport());

    let logger = winston.createLogger({
      format: winston.format.combine(winston.format.errors({ stack: true }), winston.format.json()),
      transports: transports
    });
    logger.exitOnError = false;

    return logger;
  }

  async update () {
    if (this.updateInProgress) return;
    this.updateInProgress = true;
    try {
      let pids = [];
      this.servers.forEach((server) => (server.process != null && server.process.pid != null) ? pids.push(server.process.pid) : null);
      if (pids.length > 0) {
        pidusage(pids, function (e, stats) {
          if (e) {
            this.verbose("Failed to get server process usage: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
            return;
          }
          for (let i in stats) {
            let stat = stats[i];
            if (stat == null) continue;
            /** @type Server */
            let server;
            this.servers.forEach((s) => {
              if (s.process == null || s.process.pid == null) return;
              if (s.process.pid == i) {
                server = s
                return;
              }  
            });
            if (server == null) continue;
            server.state.cpu = stat.cpu/(100*osAlt.cpuCount());
            server.state.memory = stat.memory;
          }
        }.bind(this));
      }
      
      this.servers.forEach(async (server) => {
        server.OnUpdate();
      });
      this.cpu = await getCPUPercent();
    } catch (e) {
      this.error("Failed to cycle update: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
    this.updateInProgress = false;
  }

  async stop(restarting) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.steam.activeProcess != null) {
      this.steam.queue = [];
      this.steam.activeProcess.kill();
    }
    this.seq.stop();
    this.loki.stop();
    clearInterval(this.updateInterval);
    clearInterval(this.memoryMonitor.interval);
    clearInterval(this.network.interval);
    this.echoServer.destroy();
    if (restarting == true) this.servers.forEach(async (server) => server.restart(true));
    else this.servers.forEach(async (server) => server.stop(true));
  }

  createRotatedLogTransport () {
    return new winston.transports.DailyRotateFile({
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
    });
  }

  async handleConfigEdit (path, value, previous) {
    let config = this.config;
    if (value == previous) return;
    if (!Array.isArray(path) && typeof path == "string") path = path.split(".");
    else if (!Array.isArray(path)) return; //Unknown data type was received for path
    switch (path[0]) {
      case "echoServerAddress":
      case "echoServerPort":
        this.echoServer.rebind();
        break;
      case "level":
        this.logger.transports.forEach(t => t instanceof winston.transports.Console ? t.level = value : null);
        break;
      case "verkey":
        if (value == null || value.trim() == "") config.verkey = null;
        else config.verkey = value.trim();
        if (config.verkey == null) {
          if (fs.existsSync(verkeyPath)) fs.rmSync(verkeyPath);
        } else {
          if (!fs.existsSync(path.parse(verkeyPath).dir)) fs.mkdirSync(path.parse(verkeyPath).dir, {recursive: true});
          fs.writeFileSync(verkeyPath, config.verkey);
        }
        break;
      case "cpuBalance":
        if (!this.balancer.cpuBalancingSupported) return;
        if (value) {
          this.balancer.rebalanceServers();
        } else {
          this.balancer.resetServerBalance();
        }
        break;
      case "cpusPerServer":
        if (!this.balancer.cpuBalancingSupported || !config.cpuBalance) return;
        this.balancer.rebalanceServers();
        break;
      case "seq":
        switch (path[1]) {
          case "enabled":
            if (value) {
              this.seq.start();
            } else {
              this.seq.stop();
            }
            break;
          case "apiKey":
          case "secure":
          case "host":
            if (this.seq.process == null || this.seq.stopping) return;
            this.seq.process.kill();
            break;
        }
        break;
      case "loki":
        switch (path[1]) {
          case "enabled":
            if (value) {
              this.loki.start();
            } else {
              this.loki.stop();
            }
            break;
          default:
            if (this.loki.process == null || this.loki.stopping) return;
            this.loki.process.kill();
            break;
        }
        break;
      case "logSettings":
        switch (path[1]) {
          case "enabled":
            if (value) {
              let transport = this.createRotatedLogTransport();
              this.logger.add(transport);
            } else {
              this.logger.transports.forEach(t => t instanceof winston.transports.DailyRotateFile ? this.logger.remove(t) : null);
            }
            break;
          case "maxSize":
          case "maxCount":
          case "logfolder": {
            if (!this.config.logSettings.enabled) return;
            this.logger.transports.forEach(t => t instanceof winston.transports.DailyRotateFile ? this.logger.remove(t) : null);
            let transport = this.createRotatedLogTransport();
            this.logger.add(transport);
            break;
          }
        }
        break;
      case "vega":
        switch (path[1]) {
          case "host":
          case "port":
          case "password":
          case "id":
            if (this.vega.connected) this.vega.client.destroy();
        }
        break;
      case "serversFolder":
        fs.renameSync(previous, value);
    }
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

class EchoServer {
  /** @type NVLA */
  main;

  logger;

  /** @type udp.Socket */
  server;

  constructor (m){
    this.main = m;
    this.logger = this.main.logger.child({ type: "Echo Server" });

    this.start();
  }

  destroy () {
    try {
      this.server.close();
    } catch {}
  }
  
  rebind() {
    this.log("Rebound Echo Server");
    this.destroy();
    this.start();
  }

  start () {
    this.server = udp.createSocket('udp4');
    this.server.on('error', this.echoServerError.bind(this));
    this.server.on('message', this.echoServerMessage.bind(this));
    this.server.on('listening', () => this.log("Listening on port {port}", {port: this.main.config.echoServerPort}));
    this.server.bind(this.main.config.echoServerPort, this.main.config.echoServerAddress);
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
   * @param {Buffer} msg 
   * @param {udp.RemoteInfo} rinfo 
   */
  echoServerMessage (msg, rinfo) {
    try {
      let m = msg.slice(0,4);
      this.server.send(m, rinfo.port, rinfo.address);
    } catch (e) {
      this.error("Echo response error: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
    }
  }

  echoServerError (e) {
    this.error("Error: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
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
   * @param {object} fileType 
   */
  constructor (fileType) {
      this.md5 = fileType.md5;
      this.type = fileType.subtype;
      this.path = fileType.filePath;
      this.name = fileType.name;
  }
}

class downloadSettings {
  /** @type {string} */
  url;

  /** @type {string} */
  name;

  /** @type {string} */
  password;

  /** @type {string} */
  path;

  /** @type {string} */
  type;

  /** @type {string} */
  subtype;

  /** @type {string} */
  id;

  /** @type {string} */
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
            this.config.outputPath = path.join(server.config.paths.pluginsFolderPath, name+".dll");
        } else if (subtype == "dependency") {
            this.config.path = null;
            this.config.outputPath = path.join(server.config.paths.pluginsFolderPath, "dependencies", name+".dll");
        } else if (subtype == "customAssembly") {
            this.config.path = null;
            this.config.outputPath = path.join(server.config.paths.serverCustomAssembliesFolder, name+".dll");
        }
      } else if (type == "configFile") {
        if (subtype == "pluginConfig") {
          this.config.path = JSON.stringify(spath);
          this.config.outputPath = path.join(server.config.paths.pluginsFolderPath, joinPaths(spath), name);
        } else if (subtype == "serverConfig") {
          this.config.path = JSON.stringify(spath);
          this.config.outputPath = path.join(server.config.paths.serverConfigsFolder, joinPaths(spath), name);
        } else if (subtype == "globalServerConfig") {
          this.config.path = JSON.stringify(spath);
          this.config.outputPath = path.join(server.config.paths.globalDedicatedServerConfigFiles, joinPaths(spath), name);
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
        this.resolves.reject("Failed to fork download process:\n"+e);
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

  /** @type { import('./socket.js')["Client"]["prototype"]} */
  client;

  /** @type {Map<string, {resolve: Function, reject: Function}>} */
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
    this.main.on("updateServerState", d => this.connected ? this.client.sendMessage(new mt.serverStateUpdate(d)) : null);
    this.main.on("updateMachineState", d => this.connected ? this.client.sendMessage(new mt.machineStateUpdate(d)) : null);
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
    this.main.activeTransfers.forEach((v) => {
        v.cancel("Vega Connection closed");
    });
  }

  async onError(e) {
    this.error("Vega Connection error: {e}", { e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e });
  }
}

module.exports = {winstonLoggerSeq, winstonLoggerLoki, settings, logSettings, seqSettings, lokiSettings, vegaSettings, ServerConfig, ServerPaths, restartTime, serverState, FileEvent, FileEventHandler, ServerMonitor, StandardIOHandler, Server, steamLogEvent, steam, serverTransfer,  addresses, NVLA, File, FileInfo, downloadSettings, fileDownload, Vega };