const EventEmitter = require('events');
const fs = require('fs');
const util = require('./util.js');
const ignoreSettings = [];

/** BE CAREFUL WITH THIS FUNCTION, It will process any Null values as valid properties that can be modified
 * @param {*} setting 
 * @param {Array<string>} path 
 */
function processSetting (setting, path, emit) {
  if (ignoreSettings.includes(path.join("."))) return;
  if (setting instanceof Map) {
    setting.forEach((value, key) => processSetting.bind(setting)(value, path.concat(key), emit));
    if (setting["toObject"] == null) {
      setting["toObject"] = function () {
        let o = {};
        for (let i of this) o[i[0]] = i[1].toObject(this);
        return o;
      };
    }
  } else if (typeof setting === "object" && !Array.isArray(setting) && setting !== null) {
    for (let i in setting) processSetting.bind(setting)(setting[i], path.concat(i), emit);
    let method = function () {
      let o = {};
      for (let i in this) {
        if (i.startsWith("_")) o[i.substring(1)] = setting[i];
        else if (setting[i] != null && typeof setting[i] === "object" && !Array.isArray(setting[i]) && setting[i].toObject != null && typeof setting[i].toObject == "function") o[i] = setting[i].toObject(setting);
      }
      return o;
    };
    if (setting["toObject"] == null) setting["toObject"] = method;
    else setting["toObjectSuper"] = method;
  } else if (typeof setting === "string" || typeof setting === "number" || typeof setting === "boolean" || setting === null) {
    let trueName = path[path.length-1];
    let falseName = "_"+trueName;
    this[falseName] = setting;
    Object.defineProperty(this, trueName, {
      get: function () {
        emit("get", {path: path.join("."), value: this[falseName]});
        return this[falseName];
      }.bind(this),
      set: function (newValue) {
        let old = this[falseName];
        this[falseName] = newValue;
        emit("set", {path: path.join("."), value: newValue, old});
      }.bind(this)
    });
  } else if (setting != null && Array.isArray(setting)) {
    let trueName = path[path.length-1];
    let falseName = "_"+trueName;
    this[falseName] = setting;
    this[trueName] = new Proxy(this[falseName], {
      deleteProperty: function(target, property) {
        let old = target.concat([]);
        target.splice(parseInt(property), 1);
        emit("set", {path: path.join("."), value: target, old});
        return true;
      },
      get: function (target, prop) {
        if ((typeof prop == "string" || typeof prop == "number") && !isNaN(parseInt(prop))) {
          let p = path.concat(parseInt(prop));
          emit("get", {path: p.join("."), value: this[falseName]});
          return target[prop];
        }
        if (prop == "push") {
          return function (value) {
            let old = this[falseName].concat([]);
            this[falseName].push(value);
            emit("set", {path: path.join("."), value: this[falseName], old});
          }.bind(this);
        } else return target[prop];
      }.bind(this),
      set: function (target, prop, value) {
        if (!isNaN(parseInt(prop))) {
          let old = this[falseName].concat([]);
          this[falseName][prop] = value;
          emit("set", {path: path.join("."), value: this[falseName], old});
          return true;
        }
        this[falseName][prop] = value;
        return true;
      }.bind(this)
    });
  }
}

class ConfigReadError extends Error {
  /**
   * @param {Error} error 
   */
  constructor(error) {
    super(error);
    this.name = "ConfigReadError";
    this.message = "Something went wrong reading the config file";
    this.stack = error.stack;
  }
}

class ConfigInitSaveError extends Error {
  /**
   * @param {Error} error 
   */
  constructor(error) {
    super(error);
    this.name = "ConfigInitSaveError";
    this.message = "Something went wrong saving the parsed config file";
    this.stack = error.stack;
  }

}

module.exports.errors = {
  ConfigReadError: ConfigReadError,
  ConfigInitSaveError: ConfigInitSaveError
};

module.exports.SettingChangeHandler = class SettingChangeHandler {
  /** @type {import("./core.js")["Main"]["prototype"]} */
  Main;

  /** This is a variable for disabling the settings change handler in case you want to make changes that don't trigger event code */
  disabled = false;
  
  /** @type {Map<string, Function>} */
  functionMaps = new Map();

  constructor(main) { 
    this.Main = main;
    this.Main.settings.on('set', this.handleSettingChange.bind(this));

    this.functionMaps.set("seq.apiKey", this.restartSeq.bind(this));
    this.functionMaps.set("seq.host", this.restartSeq.bind(this));
    this.functionMaps.set("seq.secure", this.restartSeq.bind(this));
    this.functionMaps.set("seq.enabled", this.updateSeqState.bind(this));

    this.functionMaps.set("log.logfolder", this.handleLogFolderChange.bind(this));
    this.functionMaps.set("log.maxSize", this.handleLogRotationChange.bind(this));
    this.functionMaps.set("log.maxCount", this.handleLogRotationChange.bind(this));
    this.functionMaps.set("log.enabled", this.updateLogFolderState.bind(this));
    this.functionMaps.set("log.logLevel", this.updateLogLevel.bind(this));

    this.functionMaps.set("Vega.label", this.handleVegaLabelChange.bind(this));
  }

  /**
   * @param {{path: string, value: *, old: *}} data 
   */
  handleSettingChange (data) {
    if (this.disabled) return;
    if (!Array.isArray(data.value) && !Array.isArray(data.old) && data.value == data.old) return;
    if (Array.isArray(data.value) && Array.isArray(data.old)) {
      data.value.sort(util.s);
      data.old.sort(util.s);
      if (util.equals(data.value, data.old)) return;
    }
    if (this.functionMaps.has(data.path)) this.functionMaps.get(data.path)(data.value, data.old, data.path);
    try {
        this.Main.settings.save();
    } catch (e) {
        this.Main.error("Failed saving settings: {e}", this.Main.lp({e}));
    }
  }

  async updateSeqState (value) {
    if (value) {
      try {
        await this.Main.logger.seq.start();
      } catch (e) {
        this.Main.error("Failed starting seq: {e}", this.Main.lp({e}));
      }
    } else {
      try {
        this.Main.logger.seq.stop();
      } catch (e) {
        this.Main.error("Failed stopping seq: {e}", this.Main.lp({e}));
      }
    }
  }

  restartSeq() {
    if (this.Main.logger.seq.process == null || this.Main.logger.seq.stopping || this.Main.logger.seq.restarting) return;
    this.Main.logger.seq.restarting = true;
    this.Main.logger.seq.process.kill();
  }

  async handleLogFolderChange (value) {
    if (!fs.existsSync(value)) {
      try {
        fs.mkdirSync(value, {recursive: true});
      } catch (e) {
        this.Main.error("Failed creating new log folder: {e}", this.Main.lp({e}));
      }
    }
    this.handleLogRotationChange();
  }

  async handleLogRotationChange () {
    if (this.Main.logger.logFileTransport != null) {
      this.Main.logger.winston.remove(this.Main.logger.logFileTransport);
      this.Main.logger.logFileTransport.close();
      this.Main.logger.logFileTransport = this.Main.logger.createRotatedLogTransport();
      this.Main.logger.winston.add(this.Main.logger.logFileTransport);
    }
  }

  async updateLogFolderState (value) {
    if (value && this.Main.logger.logFileTransport == null) {
      this.Main.logger.logFileTransport = this.Main.logger.createRotatedLogTransport();
      this.Main.logger.winston.add(this.Main.logger.logFileTransport);
    } else if (!value && this.Main.logger.logFileTransport != null) {
      this.Main.logger.winston.remove(this.Main.logger.logFileTransport);
      this.Main.logger.logFileTransport.close();
      this.Main.logger.logFileTransport = null;
    }
  }

  async updateLogLevel (value) {
    this.Main.logger.consoleTransport.level = value;
    if (this.Main.logger.logFileTransport != null) this.Main.logger.logFileTransport.level = value;
  }

  async handleVegaLabelChange (value) {
    this.Main.log("Vega label changed, updating");
    this.Main.state.label = value;
  }
}

module.exports.Settings = class Settings extends EventEmitter {

    /** @type {import("./settings.js")["SeqSettings"]["prototype"]} */
    seq = module.exports.SeqSettings;

    /** @type {import("./settings.js")["LogSettings"]["prototype"]} */
    log = module.exports.LogSettings;

    /** @type Vega */
    Vega = Vega;

    /** @type string */
    serversFolder = "./Servers";

    /** @type number */
    echoServerPort = 5051;

    /** @type string */
    echoServerAddress = "0.0.0.0";

    /** @type boolean */
    cpuBalance = true;

    /** @type number */
    cpusPerServer = 2;

    /** @type boolean */
    memoryChecker = true;

    /** @type number */
    minimumMemoryThreashold = 500000000;

    /** @type number */
    criticalMemoryThreashold = 100000000;

    /** @type string */
    verkey = null;

    /** @type number */
    serverStartTimeout = 60;

    /** @type number */
    serverRestartReqTimeout = 3;

    constructor(obj) {
      super();
      if (obj == null) {
        //Read from file system if possible, otherwise, use defaults
        if (fs.existsSync("./config.json")) {
          try {
            obj = JSON.parse(fs.readFileSync("./config.json"));
          } catch (e) {
            throw new ConfigReadError(e);
          }
        }
      }
      if (obj == null) obj = {};

      if (obj.seq != null) {
        this.seq = new this.seq(obj.seq);
        delete obj.seq;
      } else this.seq = new this.seq({});

      if (obj.log != null) {
        this.log = new this.log(obj.log);
        delete obj.log;
      } else this.log = new this.log({});

      if (obj.Vega != null) {
        this.Vega = new this.Vega(obj.Vega);
        delete obj.Vega;
      } else this.Vega = new this.Vega({});

      for (var i in obj) {
        this[i] = obj[i];
      }

      for (let i in this) if (i != "_eventsCount") processSetting.bind(this)(this[i], [i], this.emit.bind(this));

      try {
        this.save();
      } catch (e) {
        throw new ConfigInitSaveError(e);
      }
    }

    simplify () {
      let o = {};
      for (let i in this) {
        if (i.startsWith("_") || typeof this[i] == "function") continue;
        if (this[i] != null && typeof this[i] == "object" && !Array.isArray(this[i]) && this[i].toObject != null && typeof this[i].toObject == "function") o[i] = this[i].toObject(this);
        else o[i] = this[i];
      }
      return o;
    }

    save () {
      fs.writeFileSync("./config.json", JSON.stringify(this.simplify(), null, 4));
    }
}

module.exports.SeqSettings = class SeqSettings {
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

module.exports.LogSettings = class LogSettings {
  /** This will show a timestamp like [4/29 04:00:58.483] */  
  includeTimestamp = true;

  /** This will show a shortened timestamp like [04:00:58.483] */  
  useShortenedTimestamp = false;

  /** This will show the uptime of the process instead of a current timestamp */  
  useUptimeInstead = false;

  /** This looks something like [Classname.Functionname] */  
  includeSource = true;

  /** This looks something like [index.js:13:10] */  
  includeFunctionLocation = true;

  /** This will show the full path of the file instead of a relative path */  
  fullPaths = false;

  /** This will attach the stack trace to the log properties */  
  attachStacks = true;

  /** This will show the log level like [info] */  
  showLevel = false;

  /** This will show the Server labels in the console logs*/
  showLabels = true;

  logLevel = "info";

  /** The folder where logs will be stored */  
  logfolder = "./Logs";

  /** The maximum size of each log file ex. 10M or 500K */  
  maxSize = "10M";

  /** The maximum number of log files to keep */  
  maxCount = 10;

  /** This will clean up logs of garbage unity messages */
  minimizeLogs = true;

  /** Whether disk logging is enabled or not */  
  enabled = false;

  constructor(obj) {
    for (var i in obj) {
      this[i] = obj[i];
    }
  }
}

class Vega {
  /** Vega server address */
  host = "127.0.0.1";

  /** Vega server port */
  port = 5557;

  /** Vega server password */
  password = "password";

  /** Vega server label */
  label = "NVLA";

  /** @type string */
  id = null

  /** Enables debugging of vega message handler */
  debug = false;

  constructor(obj) {
    for (var i in obj) {
      this[i] = obj[i];
    }
  }
}