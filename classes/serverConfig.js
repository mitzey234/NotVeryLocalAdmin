const Util = require("./util.js");
const EventEmitter = require("events");

class RestartTime {
  hour = 0;

  minute = 0;

  constructor(obj) {
    for (var i in obj) this[i] = obj[i];
  }

  toObject() {
    return this.toObjectSuper();
  }
}

class ServerConfig extends EventEmitter {

  port = 7777;

  /** @type string */
  id = null;

  /** @type string */
  label = "Unnamed Server";

  plugins = [];

  dependancies = [];

  customAssemblies = [];

  /** @type string */
  assignedMachine = null;

  /** @type string */
  beta = null;

  /** @type string */
  betaPassword = null;

  autoStart = false;

  dailyRestarts = false;

  /** @type RestartTime */
  restartTime = RestartTime;

  maximumStartupTime = 60;

  maximumServerUnresponsiveTime = 60;

  maximumShutdownTime = 60;

  maximumRestartTime = 60;

  cleanLogs = true;

  enableVega = true;

  appDataFolderName = "LabAPI";

  pluginsFolderPath = "plugins/global";

  dependanciesFolderPath = "dependencies/global"; //Alternatively "plugins/global/dependencies"

  configsFolderPath = "configs/$PORT"; //Alternatively "plugins/global"

  /**
   * @param {import("./core.js")} main 
   * @param {object} obj 
   */
  constructor(main, obj) {
    super();

    if (obj == null) obj = {};

    if (obj.restartTime != null) {
      this.restartTime = new this.restartTime(obj.restartTime);
      delete obj.restartTime;
    } else this.restartTime = new this.restartTime({});

    for (var i in this) if (obj[i] != null) this[i] = obj[i];

    for (let i in this) if (!i.startsWith("_")) Util.processObjectProp.bind(this)(this[i], [i], this.emit.bind(this));

    this.main = main;
  }

  update (obj) {
    if (obj == null) return;

    if (obj.restartTime != null && typeof obj.restartTime == "object") {
      for (var rt in this.restartTime) if (obj.restartTime[rt] != null) this.restartTime[rt] = obj.restartTime[rt];
      delete obj.restartTime;
    }

    for (var i in this) if (!i.startsWith("_") && typeof this[i] != "function" && obj[i] != null) this[i] = obj[i];
  }

  toString() {
    return Util.filterSerializableProperties(this);
  }
}

module.exports = ServerConfig;