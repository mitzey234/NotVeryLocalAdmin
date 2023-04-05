const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn } = require("child_process");
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
const { SeqTransport } = require("@datalust/winston-seq");
const util = require("util");

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

let objectTypes = {
  test: "Formated Test",
  Server: 
  /**\
   * @param {Server} server 
   * @param {object} info 
   * @returns 
   */
  function (server, info) {
    info.serverId = server.config.id;
    info.name = server.config.label;
    return server.config.label;
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

function processPrintF(info, seq) {
  let data = (info[Symbol.for("splat")] || [])[0] || [];
  let metadata = (info[Symbol.for("splat")] || [])[1] || [];
  if (typeof data == "object" && !seq)
    for (i in data)
      if (i != "type")
        info.message = info.message.replaceAll(
          "{" + i + "}",
          typeof data[i] != "string" &&
            (data[i] != null && data[i].constructor != null
              ? data[i].constructor.name != "Error"
              : true)
            ? util.inspect(data[i], false, 7, false)
            : data[i].toString()
        );
  if (metadata.color != null && colors[metadata.color] != null && !seq)
    info.message = colors[metadata.color](info.message);
  if (!seq)
    info.message = info.message + (info.stack != null ? "\n" + info.stack : "");
  if (!seq) info.message = info.message.replaceAll("\r", "").split("\n");
  if (!seq)
    for (i in info.message)
      info.message[i] =
        `[${currTime(true)}] ${
          info.type != null ? `[${resolveType(info.type)}] ` : ""
        }` + info.message[i];
  if (!seq) info.message = info.message.join("\n");
  if (seq && info.type != null) {
    info.type = resolveType(info.type, info);
  }
}

function resolveType(type, info) {
  if (info == null) info = {};
  if (typeof type == "string") {
    if (objectTypes[type] != null)
      return typeof objectTypes[type] == "function"
        ? objectTypes[type](type, info)
        : objectTypes[type];
    else return type;
  } else if (typeof type == "object") {
    if (type.constructor == null) return "Unknown";
    let res = type.constructor.name;
    if (objectTypes[res] != null)
      return typeof objectTypes[res] == "function"
        ? objectTypes[res](type, info)
        : objectTypes[res];
    else return res;
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
      let data = fs
        .readFileSync(path.join(folder, ".ignore"))
        .toString()
        .replaceAll("\r", "");
      return data.split("\n");
    } catch (e) {
      globalNVLA.log(".ignore error: {e}", { e: e, stack: e.stack });
      return [];
    }
  } else {
    return [];
  }
}

function isIgnored(root, file) {
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

class settings {
  /** @type string */
  serversFolder = path.join(__dirname, "servers");

  /** @type vegaSettings */
  vega;

  /** @type seqSettings */
  seq;

  /** @type logSettings */
  logSettings;

  level = "info";

  constructor() {
    if (!fs.existsSync(path.join(__dirname, "config.json")))
      fs.writeFileSync(path.join(__dirname, "config.json"), "{}");
    /** @type {import("./config.json")} */
    let obj = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json")));
    this.vega = new vegaSettings(obj.vega);
    this.logSettings = new logSettings(obj.logSettings);
    this.seq = new seqSettings(obj.seq);
    for (var i in obj) {
      if (i == "vega") continue;
      this[i] = obj[i];
    }
    fs.writeFileSync(
      path.join(__dirname, "config.json"),
      JSON.stringify(this, null, 4)
    );
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
  label = null;

  /** @type string */
  id = null;

  /** @type string[] */
  plugins = [];

  /** @type string[] */
  customAssemblies = [];

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

  /** @type boolean */
  autoStart = false;
}

let ServerStates = {
  STOPPED: 0,
  STARTING: 1,
  RUNNING: 2,
  STOPPING: 3,
  UPDATING: 4,
  INSTALLING: 5,
  UNINSTALLING: 6,
  RESTARTING: 7,
  CONFIGURING: 8,
};

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

  /** @type boolean */
  installed = false;

  /** @type boolean */
  updatePending = false;

  /** @type {import("child_process")["ChildProcess"]["prototype"]} */
  process;

  /** @type import("chokidar")["FSWatcher"]["prototype"] */
  pluginsFolderWatch;

  /** @type import("chokidar")["FSWatcher"]["prototype"] */
  configFolderWatch;

  /** boolean */
  disableWatching = false;

  ignoreFilePaths = [];

  /** @type number */
  state = 0;

  /** @type number */
  uptime = 0;

  /** @type Array<string> */
  players;

  /** @type NVLA["logger"] */
  logger;

  /**
   * @param {NVLA} main
   * @param {ServerConfig} config
   */
  constructor(main, config) {
    this.main = main;
    this.logger = main.logger.child({type: this});
    this.config = config;
    this.serverContainer = path.join(
      this.main.config.serversFolder,
      this.config.id
    );
    this.serverInstallFolder = path.join(this.serverContainer, "scpsl");
    this.dedicatedServerAppdata = path.join(
      this.serverInstallFolder,
      "AppData",
      "SCP Secret Laboratory"
    );
    this.pluginsFolderPath = path.join(
      this.dedicatedServerAppdata,
      "PluginAPI",
      "plugins",
      "global"
    );
    this.serverConfigsFolder = path.join(
      this.serverInstallFolder,
      "AppData",
      "config",
      config.port.toString()
    );
    this.serverCustomAssembliesFolder = path.join(
      this.serverInstallFolder,
      "SCPSL_Data",
      "Managed"
    );

    try {
      if (!fs.existsSync(this.pluginsFolderPath))
        fs.mkdirSync(this.pluginsFolderPath, { recursive: true });
      if (!fs.existsSync(this.serverConfigsFolder))
        fs.mkdirSync(this.serverConfigsFolder, { recursive: true });
      this.setupWatchers();
    } catch (e) {
      this.main.error.bind(this)("Failed to create folders: " + e);
    }
  }

  log(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.verbose(arg, obj, meta);
  }

  async setupWatchers() {
    await this.stopWatchers();
    this.pluginsFolderWatch = chokidar.watch(this.pluginsFolderPath, {
      ignoreInitial: true,
      persistent: true,
    });
    this.pluginsFolderWatch.on("all", this.onPluginConfigFileEvent.bind(this));
    this.pluginsFolderWatch.on("error", this.main.error.bind(this));
    this.configFolderWatch = chokidar.watch(this.serverConfigsFolder, {
      ignoreInitial: true,
      persistent: true,
    });
    this.configFolderWatch.on("all", this.onConfigFileEvent.bind(this));
    this.configFolderWatch.on("error", this.main.error.bind(this));
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
  }

  async onConfigFileEvent(event, filePath) {
    if (this.disableWatching) return;
    filePath = path.relative(this.serverConfigsFolder, filePath);
    if (
      isIgnored(
        this.serverConfigsFolder,
        path.join(this.serverConfigsFolder, filePath)
      )
    )
      return;
    if (this.ignoreFilePaths.includes(filePath))
      return (this.ignoreFilePaths = this.ignoreFilePaths.filter(
        (x) => x != filePath
      ));
    if (event == "add" || event == "change") {
      this.main.vega.client.sendMessage(
        new mt.updateConfigFile(
          this.config.id,
          filePath,
          fs
            .readFileSync(path.join(this.serverConfigsFolder, filePath))
            .toString("base64")
        )
      );
    } else if (event == "unlink") {
      this.main.vega.client.sendMessage(
        new mt.removeConfigFile(this.config.id, filePath)
      );
    }
    this.log(
      "Config file event: {event} {filePath}",
      { event: event, filePath: filePath },
      { color: 6 }
    );
  }

  async onPluginConfigFileEvent(event, filePath) {
    if (this.disableWatching) return;
    filePath = path.relative(this.pluginsFolderPath, filePath);
    if (
      isIgnored(
        this.pluginsFolderPath,
        path.join(this.pluginsFolderPath, filePath)
      )
    )
      return;
    if (filePath.startsWith("dependencies") || filePath.endsWith(".dll"))
      return;
    if (this.ignoreFilePaths.includes(filePath))
      return (this.ignoreFilePaths = this.ignoreFilePaths.filter(
        (x) => x != filePath
      ));
    if (event == "add" || event == "change") {
      this.main.vega.client.sendMessage(
        new mt.updatePluginConfigFile(
          this.config.id,
          filePath,
          fs
            .readFileSync(path.join(this.pluginsFolderPath, filePath))
            .toString("base64")
        )
      );
    } else if (event == "unlink") {
      this.main.vega.client.sendMessage(
        new mt.removePluginConfigFile(this.config.id, filePath)
      );
    }
    this.log(
      "Plugin config file event: {event} {filePath}",
      { event: event, filePath: filePath },
      { color: 6 }
    );
  }

  async getPluginConfigFiles() {
    /** @type {File[]} */
    let files;
    try {
      files = await this.main.vega.getPluginConfiguration(this.config.id);
    } catch (e) {
      this.main.error.bind(this)("Failed to get plugin configs: " + e);
    }
    let usedFolders = ["dependencies"];
    for (var x in files) {
      /** @type {File} */
      let file = files[x];
      let filePath = path.join(this.pluginsFolderPath, file.path);
      if (!usedFolders.includes(path.parse(file.path).dir))
        usedFolders.push(path.parse(file.path).dir);
      this.log("Writing: {path}", { path: file.path });
      try {
        fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to create plugin config directory: " + e
        );
        continue;
      }
      try {
        this.ignoreFilePaths.push(file.path);
        fs.writeFileSync(filePath, file.data, { encoding: "base64" });
      } catch (e) {
        this.main.error.bind(this)("Failed to write plugin config file: " + e);
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
        if (path.join(joinPaths(file.p) || "./", file.filename) == alt.path) {
          safe = true;
          break;
        }
      }
      try {
        if (
          !isIgnored(
            this.pluginsFolderPath,
            path.join(
              this.pluginsFolderPath,
              joinPaths(file.p) || "",
              file.filename
            )
          ) &&
          !safe &&
          !path
            .join(joinPaths(file.p) || "", file.filename)
            .startsWith("dependencies") &&
          !(
            file.filename.endsWith(".dll") &&
            path.parse(path.join(joinPaths(file.p) || "", file.filename)).dir ==
              ""
          )
        ) {
          this.main.log.bind(this)(
            "Deleting: " + path.join(joinPaths(file.p) || "", file.filename)
          );
          this.ignoreFilePaths.push(
            path.join(joinPaths(file.p) || "", file.filename)
          );
          fs.rmSync(
            path.join(
              this.pluginsFolderPath,
              joinPaths(file.p) || "",
              file.filename
            ),
            { recursive: true }
          );
        }
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to delete unneeded plugin config file: ",
          e
        );
        continue;
      }
    }
    for (i in folders) {
      if (
        usedFolders.includes(
          path.join(joinPaths(folders[i].p), folders[i].filename)
        ) ||
        isIgnored(
          this.pluginsFolderPath,
          path.join(
            this.pluginsFolderPath,
            joinPaths(folders[i].p) || "",
            folders[i].filename
          )
        )
      )
        continue;
      this.main.log.bind(this)(
        "Deleting: " +
          path.join(joinPaths(folders[i].p) || "", folders[i].filename)
      );
      try {
        fs.rmSync(
          path.join(
            this.pluginsFolderPath,
            joinPaths(folders[i].p) || "",
            folders[i].filename
          ),
          { recursive: true }
        );
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to delete unneeded plugin config folder: ",
          e
        );
        continue;
      }
    }
    this.main.log.bind(this)("Wrote plugin configs");
  }

  async getPlugins() {
    for (var i in this.config.plugins) {
      let plugin = this.config.plugins[i];
      /** @type {File} */
      let pluginData;
      try {
        pluginData = await this.main.vega.getPlugin(plugin);
        fs.writeFileSync(
          path.join(this.pluginsFolderPath, plugin + ".dll"),
          Buffer.from(pluginData.data, "base64")
        );
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to get plugin '" + plugin + "': " + e
        );
        continue;
      }
    }
    let files = fs.readdirSync(this.pluginsFolderPath);
    for (var i in files) {
      let file = files[i];
      if (
        file.endsWith(".dll") &&
        !this.config.plugins.includes(file.replace(".dll", ""))
      ) {
        this.main.log.bind(this)("Deleting: " + file);
        try {
          fs.rmSync(path.join(this.pluginsFolderPath, file), {
            recursive: true,
          });
        } catch (e) {
          this.main.error.bind(this)("Failed to delete unneeded plugin: ", e);
          continue;
        }
      }
    }
    this.main.log.bind(this)("Installed plugins");
  }

  async getCustomAssemblies() {
    for (var i in this.config.customAssemblies) {
      let customAssembly = this.config.customAssemblies[i];
      /** @type {File} */
      let customAssemblyData;
      try {
        customAssemblyData = await this.main.vega.getCustomAssembly(
          customAssembly
        );
        fs.writeFileSync(
          path.join(this.serverCustomAssembliesFolder, customAssembly + ".dll"),
          Buffer.from(customAssemblyData.data, "base64")
        );
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to get custom assembly '" + customAssembly + "': " + e
        );
        continue;
      }
    }
    this.main.log.bind(this)("Installed custom Assemblies");
  }

  async getDependencies() {
    let targetFolder = path.join(this.pluginsFolderPath, "dependencies");
    try {
      if (!fs.existsSync(targetFolder))
        fs.mkdirSync(targetFolder, { recursive: true });
    } catch (e) {
      this.main.error.bind(this)("Failed to create dependencies folder: " + e);
      return;
    }
    for (var i in this.config.dependencies) {
      let dependency = this.config.dependencies[i];
      /** @type {File} */
      let dependencyData;
      try {
        dependencyData = await this.main.vega.getDependency(dependency);
        fs.writeFileSync(
          path.join(targetFolder, dependency + ".dll"),
          Buffer.from(dependencyData.data, "base64")
        );
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to get dependency '" + dependency + "': " + e
        );
        continue;
      }
    }
    this.main.log.bind(this)("Installed dependencies");
  }

  async getDedicatedServerConfigFiles() {
    /** @type {File[]} */
    let files;
    try {
      files = await this.main.vega.getDedicatedServerConfiguration(
        this.config.id
      );
    } catch (e) {
      this.main.error.bind(this)("Failed to get plugin configs: " + e);
    }
    let usedFolders = [];
    for (var x in files) {
      /** @type {File} */
      let file = files[x];
      let filePath = path.join(this.serverConfigsFolder, file.path);
      if (!usedFolders.includes(path.parse(file.path).dir))
        usedFolders.push(path.parse(file.path).dir);
      this.main.log.bind(this)("Writing: " + file.path);
      try {
        fs.mkdirSync(path.parse(filePath).dir, { recursive: true });
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to create dedicated server config directory: " + e
        );
        continue;
      }
      try {
        this.ignoreFilePaths.push(file.path);
        fs.writeFileSync(filePath, file.data, { encoding: "base64" });
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to write dedicated server config file: " + e
        );
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
        if (path.join(joinPaths(file.p) || "./", file.filename) == alt.path) {
          safe = true;
          break;
        }
      }
      try {
        if (!safe) {
          this.main.log.bind(this)(
            "Deleting: " + path.join(joinPaths(file.p) || "", file.filename)
          );
          this.ignoreFilePaths.push(
            path.join(joinPaths(file.p) || "", file.filename)
          );
          fs.rmSync(
            path.join(
              this.serverConfigsFolder,
              joinPaths(file.p) || "",
              file.filename
            ),
            { recursive: true }
          );
        }
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to delete unneeded dedicated server config file: ",
          e
        );
        continue;
      }
    }
    for (i in folders) {
      if (
        usedFolders.includes(
          path.join(joinPaths(folders[i].p), folders[i].filename)
        )
      )
        continue;
      this.main.log.bind(this)(
        "Deleting: " +
          path.join(joinPaths(folders[i].p) || "", folders[i].filename)
      );
      try {
        fs.rmSync(
          path.join(
            this.serverConfigsFolder,
            joinPaths(folders[i].p) || "",
            folders[i].filename
          ),
          { recursive: true }
        );
      } catch (e) {
        this.main.error.bind(this)(
          "Failed to delete unneeded dedicated server config folder: ",
          e
        );
        continue;
      }
    }
    this.main.log.bind(this)("Wrote dedicated server configs");
  }

  async configure() {
    let oldState = this.state;
    this.setState(ServerStates.CONFIGURING);
    this.log("Configuring server {label}", { label: this.config.label });
    try {
      await this.getPluginConfigFiles();
    } catch (e) {
      this.main.error.bind(this)("Failed to get plugin configs:", e);
      return;
    }
    try {
      await this.getDependencies();
    } catch (e) {
      this.main.error.bind(this)("Failed to get dependencies:", e);
      return;
    }
    try {
      await this.getPlugins();
    } catch (e) {
      this.main.error.bind(this)("Failed to get plugins:", e);
      return;
    }
    try {
      await this.getCustomAssemblies();
    } catch (e) {
      this.main.error.bind(this)("Failed to get custom assemblies:", e);
      return;
    }
    try {
      await this.getDedicatedServerConfigFiles();
    } catch (e) {
      this.main.error.bind(this)("Failed to get dedicated server configs:", e);
      return;
    }
    if (this.config.verkey != null && this.config.verkey.trim() != "") {
      try {
        fs.writeFileSync(
          path.join(this.dedicatedServerAppdata, "verkey.txt"),
          this.config.verkey
        );
      } catch (e) {
        this.main.error.bind(this)("Failed to write verkey.txt:", e);
      }
    } else {
      try {
        if (fs.existsSync(path.join(this.dedicatedServerAppdata, "verkey.txt")))
          fs.rmSync(path.join(this.dedicatedServerAppdata, "verkey.txt"));
      } catch (e) {
        this.main.error.bind(this)("Failed to delete verkey.txt:", e);
      }
    }
    fs.writeFileSync(
      path.join(this.serverInstallFolder, "hoster_policy.txt"),
      "gamedir_for_configs: true"
    );
    if (this.process != null) this.updatePending = true;
    if (this.state == ServerStates.CONFIGURING) this.setState(oldState);
    if (this.config.autoStart && this.process == null) this.start();
  }

  async install() {
    this.main.log.bind(this)("Installing server " + this.config.label);
    try {
      let result = await this.main.steam.downloadApp(
        "996560",
        this.serverInstallFolder,
        this.config.beta,
        this.config.betaPassword,
        this.config.installArguments
      );
      if (result != 0) throw "Failed to install server";
      this.main.log.bind(this)("Installed SCPSL");
      this.installed = true;
    } catch (e) {
      this.main.error.bind(this)("Failed to install server:", e);
      return;
    }
    await this.configure();
  }

  async uninstall() {
    this.disableWatching = true;
    await this.stopWatchers();
    this.main.log.bind(this)("Uninstalling server " + this.config.label);
    if (this.process != null) await this.stop(true);
    fs.rmSync(this.serverContainer, { recursive: true });
  }

  async update() {
    if (this.state == ServerStates.UPDATING) return;
    let oldState = this.state;
    this.setState(ServerStates.UPDATING);
    this.main.log.bind(this)(
      "Updating server " + this.config.label,
      this.config
    );
    try {
      let result = await this.main.steam.downloadApp(
        "996560",
        this.serverInstallFolder,
        this.config.beta,
        this.config.betaPassword,
        this.config.installArguments
      );
      if (result != 0) throw "Failed to update server";
      this.main.log.bind(this)("Updated SCPSL");
      if (this.process != null) this.updatePending = true;
    } catch (e) {
      this.main.error.bind(this)("Failed to install server: " + e);
      return;
    }
    try {
      await this.getCustomAssemblies();
    } catch (e) {
      this.main.error.bind(this)("Failed to get custom assemblies:", e);
      return;
    }
    if (this.state == ServerStates.UPDATING) this.setState(oldState);
  }

  /**
   * @returns {Promise<Net.Server>}
   */
  createSocket() {
    return new Promise(
      function (resolve, reject) {
        let server = new Net.Server();
        server.listen(
          0,
          function (s, resolve) {
            resolve(s);
          }.bind(this, server, resolve)
        );
        setTimeout(
          function (reject) {
            reject("Socket took too long to open");
          }.bind(null, reject),
          1000
        );
      }.bind(this)
    );
  }

  async stop(forced) {
    if (this.process == null) return -1; //Server process not active
    if (this.stopInProg != null) return -2;
    this.main.log.bind(this)(
      (forced ? "Force " : "") + "Stopping server " + this.config.label
    );
  }

  async setState(state) {
    this.state = state;
    this.main.emit("serverStateChange", this);
  }

  async handleExit(code, signal) {
    this.log("Server Process Exited with {code} - {signal}", {code: code, signal: signal}, {color: 4});
    this.process = null;
    this.players = null;
    this.uptime = null;
  }

  async handleError(e) {
    this.main.error.bind(this)("Error launching server:", e);
  }

  async handleStdout(data) {
    let d = data.toString().split("\n");
    for (i in d)
      if (d[i].trim() != "") {
        if (
          d[i].indexOf("The referenced script") > -1 &&
          d[i].indexOf("on this Behaviour") > -1 &&
          d[i].indexOf("is missing!") > -1
        )
          continue;
        if (d[i].indexOf("Filename:  Line: ") > -1) continue;
        if (
          d[i].indexOf("A scripted object") > -1 &&
          d[i].indexOf("has a different serialization layout when loading.") >
            -1
        )
          continue;
        if (
          d[i].indexOf(
            "Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?"
          ) > -1
        )
          continue;
        if (
          d[i].indexOf("Action name") > -1 &&
          d[i].indexOf("is not defined") > -1
        )
          continue;
        this.main.log.bind(this)(d[i]);
      }
  }

  async handleStderr(data) {
    let d = data.toString().split("\n");
    for (i in d)
      if (d[i].trim() != "") {
        if (
          d[i].indexOf("The referenced script") > -1 &&
          d[i].indexOf("on this Behaviour") > -1 &&
          d[i].indexOf("is missing!") > -1
        )
          continue;
        if (d[i].indexOf("Filename:  Line: ") > -1) continue;
        if (
          d[i].indexOf("A scripted object") > -1 &&
          d[i].indexOf("has a different serialization layout when loading.") >
            -1
        )
          continue;
        if (
          d[i].indexOf(
            "Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?"
          ) > -1
        )
          continue;
        if (
          d[i].indexOf("Action name") > -1 &&
          d[i].indexOf("is not defined") > -1
        )
          continue;
        this.main.error.bind(this)(d[i]);
      }
  }

  async start() {
    if (this.process != null) return -1; //Server process already active
    if (this.state == ServerStates.STARTING) return -2; //Server is already starting
    this.main.log.bind(this)("Starting server " + this.config.label);
    this.setState(ServerStates.STARTING);
    this.uptime = new Date().getTime();
    this.players = null;
    try {
      this.socket = await this.createSocket();
      const address = this.socket.address();
      this.consolePort = address.port;
      this.log.bind("Console socket created on {port}", {port: this.consolePort});
    } catch (e) {
      this.main.error.bind(this)("Failed to create console socket:", e);
      return -3;
    }
    let executable = fs.existsSync(
      path.join(this.serverInstallFolder, "SCPSL.exe")
    )
      ? path.join(this.serverInstallFolder, "SCPSL.exe")
      : fs.existsSync(path.join(this.serverInstallFolder, "SCPSL.x86_64"))
      ? path.join(this.serverInstallFolder, "SCPSL.x86_64")
      : null;
    if (executable == null) {
      this.main.error.bind(this)("Failed to find executable");
      return -4;
    }
    let cwd = path.parse(executable).dir;
    let base = path.parse(executable).base;
    try {
      this.process = spawn(
        (process.platform == "win32" ? "" : "./") + base,
        [
          "-batchmode",
          "-nographics",
          "-nodedicateddelete",
          "-port" + this.config.port,
          "-console" + this.consolePort,
          "-id" + process.pid,
          "-appdatapath",
          path.relative(cwd, this.serverContainer),
          "-vegaId " + this.config.id,
        ],
        { cwd: cwd }
      );
    } catch (e) {
      this.main.error.bind(this)("Failed to start server:", e);
      return -5;
    }
    this.process.stdout.on("data", this.handleStdout.bind(this));
    this.process.stderr.on("data", this.handleStderr.bind(this));
    this.process.on("error", this.handleError.bind(this));
    this.process.on("exit", this.handleExit.bind(this));
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

  /** @type Array<Function> */
  queue = [];

  /** @type NVLA["logger"] */
  logger;

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
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
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
        this.emit("percentage", percent);
        this.state = str.substring(7, str.length);
        if (
          this.state.indexOf("(") > -1 &&
          this.state.indexOf(")") > -1 &&
          this.state.indexOf(" of ") > -1
        )
          this.state = this.state.replace(
            this.state.substring(
              this.state.indexOf("(") - 1,
              this.state.indexOf(")") + 1
            ),
            ""
          );
        this.log(
          "Got current install state: {percentage} - {state}",
          { percentage: this.percentage, state: this.state },
          { color: 3 }
        );
        this.emit("state", this.state);
        if (
          str.indexOf("(") > -1 &&
          str.indexOf(")") > -1 &&
          str.indexOf(" of ") > -1
        ) {
          let progress = str.substring(str.indexOf("(") + 1, str.indexOf(")"));
          progress = progress
            .replace(" KB", "")
            .replaceAll(",", "")
            .split(" of ");
          this.kbytesDownloaded = parseInt(progress[0]);
          this.kbytesTotal = parseInt(progress[1]);
          this.emit("progress", {
            downloaded: this.kbytesDownloaded,
            total: this.kbytesTotal,
          });
        }
      } else if (
        str.startsWith(" Update state") &&
        str.indexOf("(") > -1 &&
        str.indexOf(")") > -1
      ) {
        this.state = str.substring(str.indexOf(") ") + 2, str.indexOf(","));
        let alt = str.split(",")[1];
        this.percentage = parseFloat(
          alt.substring(alt.indexOf(": ") + 2, alt.indexOf(" ("))
        );
        this.emit("percentage", this.percentage);
        let progress = alt.substring(alt.indexOf("(") + 1, alt.indexOf(")"));
        this.kbytesDownloaded = Math.floor(
          parseInt(progress.split(" / ")[0]) / 1000
        );
        this.kbytesTotal = Math.floor(
          parseInt(progress.split(" / ")[1]) / 1000
        );
        this.emit("progress", {
          downloaded: this.kbytesDownloaded,
          total: this.kbytesTotal,
        });
        this.log(
          "Got current install state: {percentage} - {state} - {downloaded}/{total}",
          {
            percentage: this.percentage,
            state: this.state,
            downloaded: this.kbytesDownloaded,
            total: this.kbytesTotal,
          },
          { color: 3 }
        );
      }
    } catch (e) {
      this.error("Error in steam stdout: {e}", { e: e.code || e.message, stack: e.stack });
    }
  }

  async run(params) {
    this.verbose(
      "Steam binary path: {path}",
      { path: this.binaryPath },
      { color: 6 }
    );

    let proc = pty.spawn(
      process.platform === "win32" ? "powershell.exe" : "bash",
      [],
      {
        cwd: path.parse(this.binaryPath).dir,
        env: process.env,
      }
    );

    proc.write(this.binaryPath + " " + params.join(" ") + "\r");
    proc.write(
      process.platform === "win32" ? "exit $LASTEXITCODE\r" : "exit $?\r"
    );

    proc.on(
      "data",
      function (data) {
        let d = data.toString().split("\n");
        for (var i in d) {
          try {
            this.onstdout(this.runId, d[i], true);
          } catch (e) {
            this.error("Error in steam stdout {e}", {
              e: e.code || e.message,
              stack: e.stack,
            });
          }
        }
      }.bind(this)
    );

    let code = await new Promise(
      function (resolve, reject) {
        this.on("exit", resolve);
      }.bind(proc)
    );
    this.log(
      "Steam binary finished with code: {code}",
      { code: code },
      { color: 3 }
    );
    if (code == 42 || code == 7) {
      this.log("Steam binary updated, restarting", null, { color: 3 });
      return this.run(params); //If exit code is 42, steamcmd updated and triggered magic restart
    } else if (code == 0) return code;
    else {
      let error = "";
      if (code == 254) error = "Could not connect to steam for update";
      if (code == 5) error = "Login Failure";
      if (code == 8) error = "Failed to install";
      this.error("Steam execution failed: {code} {error}", {
        code: code,
        error: error,
      });
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
      this.main.log.bind(this)("Steam execution caused exception:", e);
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
    //url = "http://localhost:3000/"; //Temporary pls remove
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
        e: e.code || e.message,
        stack: e.stack,
      });
      return -3;
    }
    this.log("Selecting decompression method", null, { color: 5 });
    if (process.platform != "win32") {
      try {
        buffer = require("zlib").gunzipSync(buffer.data);
      } catch (e) {
        this.log("Failed to decompress zip: {e}", {
          e: e.code || e.message,
          stack: e.stack,
        });
        return -1;
      }
      let tar = require("tar-fs");
      let writer = tar.extract(basePath);
      try {
        let obj = { resolve: function () {}, reject: function () {} };
        setTimeout(function () {
          writer.write(buffer);
          writer.end();
        }, 100);
        await new Promise(
          function (resolve, reject) {
            this.on("finish", resolve);
            this.on("error", reject);
          }.bind(writer)
        );
      } catch (e) {
        this.error("Failed extraction: {e}", { e: e.code || e.message, stack: e.stack });
        return -2;
      }
      this.log("Extraction complete", null, { color: 5 });
    } else {
      buffer = buffer.data;
      const AdmZip = require("adm-zip");
      try {
        this.log(
          "Decompressing file: {path}",
          { path: basePath },
          { color: 5 }
        );
        let zip = new AdmZip(buffer);
        zip.extractAllTo(basePath, true, true);
        this.log("Extraction complete", null, { color: 5 });
      } catch (err) {
        this.error("Failed extraction: {e}", { e: e.code || e.message, stack: e.stack });
        return -2;
      }
    }
    return 1;
  }
}

setInterval(() => {}, 1000);

class ServerManager extends EventEmitter {
  /** @type Map<String,Server> */
  servers = new Map();

  constructor() {
    super();
  }

  loadLocalConfiguration() {}
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
  ServerManager;

  /** @type import("winston")["Logger"]["prototype"] */
  logger;

  constructor() {
    super();
    this.config = new settings();

    let transports = [
      new winston.transports.Console({
        level: this.config.logSettings.level,
        format: winston.format.printf((info) => {
          processPrintF(info);
          if (info.level == "error") info.message = chalk.red(info.message);
          return info.message;
        }),
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
    if (this.config.seq.enabled) {
      transports.push(
        new SeqTransport({
          level: "verbose",
          format: winston.format.printf((info) => {
            processPrintF(info, true);
            info.message = info.message.replace(ansiStripRegex, "");
            return info.message;
          }),
          serverUrl:"http" + (this.config.seq.secure ? "s" : "") + "://" + this.config.seq.host,
          apiKey: this.config.seq.apiKey,
          onError: (e) => {
            console.error(e);
          },
        })
      );
    }
    
    this.logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: transports,
    });

    this.logger.exitOnError = false;
  }

  async start() {
    var serversPath = defaultServersPath;
    if (
      this.config.overrideServersPath &&
      this.config.overrideServersPath.trim() != ""
    )
      basePath = overridePath;
    if (Array.isArray(serversPath)) serversPath = joinPaths(serversPath);
    if (!fs.existsSync(serversPath))
      fs.mkdirSync(serversPath, { recursive: true });
    this.steam = new steam(this);
    /*
    let check = await this.steam.check();
    if (this.steam.found != true || (typeof check == "number" && check != 0) || !this.steam.ready) {
      this.error("Steam check failed: {e}", { e: check });
      process.exit();
    }
    */
    this.log("Steam ready", null, { color: "blue" });
    this.ServerManager = new ServerManager();
    this.ServerManager.loadLocalConfiguration();
    this.vega = new Vega(this);
    this.vega.connect();
  }

  log(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.verbose(arg, obj, meta);
  }
}

class File {
  /** @type {string} */
  path;

  /** Base64 encoded data
   * @type {string} */
  data;

  constructor(path, data) {
    this.path = path;
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
    this.logger = main.logger.child({type: this});
    this.config = main.config;
    this.messageHandler = new messageHandler(this, module.exports);
  }

  log(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.info(arg, obj, meta);
  }

  error(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
    this.logger.error(arg, obj, meta);
  }

  verbose(arg, obj, meta) {
    if (obj == null) obj = {};
    obj.type = this;
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
      this.error("Failed to handle message: {e} {messageType}", {e: e.code || e.message, stack: e.stack, messageType: m.type});
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
      this.client.sendMessage(
        new mt.pluginConfigurationRequest(
          this,
          { resolve: resolve, reject: reject },
          serverId
        )
      );
    });
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getPlugin(plugin) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting plugin: {plugin}", {plugin: plugin});
    return new Promise((resolve, reject) => {
      this.client.sendMessage(
        new mt.pluginRequest(this, { resolve: resolve, reject: reject }, plugin)
      );
    });
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getCustomAssembly(customAssembly) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting custom assembly: {customAssembly}", {customAssembly: customAssembly});
    return new Promise((resolve, reject) => {
      this.client.sendMessage(
        new mt.customAssemblyRequest(
          this,
          { resolve: resolve, reject: reject },
          customAssembly
        )
      );
    });
  }

  /**
   * @param {string} plugin
   * @returns Promise<File>
   */
  async getDependency(dependency) {
    if (!this.connected) throw "Not connected to Vega";
    this.log("Requesting dependency: {dependency}", {dependency: dependency});
    return new Promise((resolve, reject) => {
      this.client.sendMessage(
        new mt.dependencyRequest(
          this,
          { resolve: resolve, reject: reject },
          dependency
        )
      );
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
      this.client.sendMessage(
        new mt.dedicatedServerConfigurationRequest(
          this,
          { resolve: resolve, reject: reject },
          serverId
        )
      );
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
    this.error("Vega Connection error: {e}", {e: e.code || e.message, stack: e.stack});
  }

  async getServers() {}
}

module.exports = {
  NVLA: NVLA,
  Vega: Vega,
  ServerConfig: ServerConfig,
  Server: Server,
  File: File,
};
