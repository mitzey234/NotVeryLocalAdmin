#!/usr/bin/env node
var version = "1.1.3";
const fs = require("fs");
const Net = require('net');
const path = require("path");
const { spawn } = require('child_process');
const os = require("os");
const chalk = require('chalk');
const winston = require('winston');
const pidusage = require('pidusage');
const util = require('util');
require('winston-daily-rotate-file');
const bent = require('bent');
const getJSON = bent('json');
const semver = require('semver');
var url = "https://api.github.com/repos/mitzey234/NotVeryLocalAdmin/releases/latest";

var configPath = "config.json";

var Conflag = false;
for (i in process.argv) {
  console.log(process.argv[i]);
  if (Conflag) {
    Conflag = false;
    if (!fs.existsSync(process.argv[i])) {
      console.log("Config path does not exist:" + process.argv[i]);
      process.exit(1);
    }
    configPath = process.argv[i];
    continue;
  }
  if (process.argv[i] == "-config") {
    Conflag = true;
    continue;
  }
}

var config;

var isWin = os.platform() == "win32";

if (fs.existsSync(configPath)) {
  var rawdata = fs.readFileSync(configPath);
  try {
    config = JSON.parse(rawdata);
  } catch (e) {
    console.log("Error reading config", e);
    process.exit(0);
  }
  var check = checkConfig(config)
  if (check != true) {
    console.log("Config file error:", check);
    process.exit(0);
  }
} else {
  console.log("configs not found!")
  process.exit(0);
}

if (!fs.existsSync(config.logFolder)) {
  try {
    fs.mkdirSync(config.logFolder);
  } catch (e) {
    console.log("Error preparing log folder!", e);
    process.exit(1);
  }
}

if (config.SCPExecutable == null) {
  console.log(chalk.red("SCP Executable not specified, check config."));
  process.exit();
} else if (!fs.existsSync(config.SCPExecutable)) {
  console.log(chalk.red("SCP Executable not found, check config."));
  process.exit();
}

//Version checking AFTER config checking
getJSON(url, null, {"User-agent":'PostmanRuntime/7.28.3'})
.then(d => {
  if (semver.lt(version, semver.clean(d.tag_name))) logger.info(chalk.yellow("New version of NVLA is available! "+d.tag_name+" ("+d.html_url+")"))
  else if (semver.eq(version, semver.clean(d.tag_name))) logger.info(chalk.green("Running latest NVLA - " + version));
  else logger.info(chalk.cyan("Running Pre-release Version of NVLA, be careful"));
})
.catch(e => {
  logger.warn("Failed to check for NVLA updates: ", e);
});

var servers = {};
var colors = {
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
  15: chalk.gray
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
var updateInt;

async function createServer (i) {
  var o = {};
  logger.info("Creating Server Instance: "+ chalk.cyan(config.servers[i].l || config.servers[i].uid));
  o.objectType = "server";
  o.uid = config.servers[i].uid
  o.name = config.servers[i].l || config.servers[i].uid;
  o.lastRestart = null;
  o.config = config.servers[i];
  o.start = startServer.bind(o);
  o.startTimeout = startTimeout.bind(o);
  o.stop = stopServer.bind(o);
  o.forceRestart = forceRestart.bind(o);
  o.restart = restartServer.bind(o);
  o.check = checkServer.bind(o);
  o.checkTimeout = checkTimeout.bind(o);
  o.restartTimeout = restartTimeout.bind(o);
  o.handleServerEvent = handleServerEvent.bind(o);
  o.handleServerMessage = handleServerMessage.bind(o);
  o.shutdownTimeout = shutdownTimeout.bind(o);
  o.forceStop = forceStop.bind(o);
  o.command = processCommand.bind(o);
  o.checkInt = null;
  o.server = await createSocket();
  o.server.on('connection', onSocket.bind(o));
  o.logger = newServerTransport(o);
  o.logger.verbose("\n\n--- These lines intentionally left bank to help identify logging start ---\n");
  o.logger.info(chalk.red("Logging Started"));
  servers[o.uid] = o;
  checkInitServer();
}

const removeRegEx = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function newServerTransport (server) {
  return winston.createLogger({
      transports: [
        new winston.transports.Console({ level: 'info', format: winston.format.combine(Form(), winston.format.printf((info) => {return "[" + currTime2() + "] ["+server.name+"] " + `${info.message}`;}))}),
        new winston.transports.DailyRotateFile({ level: 'verbose', frequency: '24h', datePattern: 'YYYY-MM-DD', filename: path.join(config.logFolder, server.name+"/"+server.name+'-%DATE%.log'), maxsize: config.loggingMaxSize, maxFiles: config.loggingMaxDays, tailable: true, format: winston.format.combine(Form(), winston.format.printf((info) => {return "[" + currTime() + "] ["+server.name+"] ["+info.level.toUpperCase()+"] " + `${info.message.replace(removeRegEx,"")}`;}))})
      ]
  });
}

function currTime () {
  var d = new Date();
  var milli = d.getMilliseconds().toString();
  var sec = d.getSeconds().toString();
  var min = d.getMinutes().toString();
  while (milli.length < 3) milli = milli + "0";
  while (sec.length < 2) sec = "0" + sec;
  while (min.length < 2) min = "0" + min;
  var str = (parseInt(d.getMonth())+1) + "/" + d.getDate() + " " + d.getHours() + ":" + min + ":" + sec + "." + milli;
  return str;
}

function currTime2 () {
  var d = new Date();
  var milli = d.getMilliseconds().toString();
  var sec = d.getSeconds().toString();
  var min = d.getMinutes().toString();
  while (milli.length < 3) milli = milli + "0";
  while (sec.length < 2) sec = "0" + sec;
  while (min.length < 2) min = "0" + min;
  var str = (d.getHours() + ":" + min + ":" + sec + "." + milli);
  return str;
}

var Form = winston.format((info, opts) => {
  var t = info.message;
  if (typeof info.message != "string") t = util.inspect(t, false, 7, false);
  //info.message = "[" + currTime() + "] " + t;
  info.message = t;
  t = null;
  var splat = info[Symbol.for("splat")];
  if (splat != null && splat.length > 0) {
    for (x in splat) {
      var t = splat[x];
      if (typeof t != "string") t = util.inspect(t, false, 7, false);
      info.message += ' ' + t;
    }
  }
  delete info[Symbol.for("splat")];
  return info;
});

var logger = winston.createLogger({
    transports: [
      new winston.transports.Console({ level: 'info', format: winston.format.combine(Form(), winston.format.printf((info) => {return "[" + currTime2() + "] " + `${info.message}`;}))}),
      new winston.transports.DailyRotateFile({ level: 'verbose', frequency: '24h', datePattern: 'YYYY-MM-DD', filename: path.join(config.logFolder, 'Main-%DATE%.log'), maxsize: config.loggingMaxSize, maxFiles: config.loggingMaxDays, tailable: true, format: winston.format.combine(Form(), winston.format.printf((info) => {return "[" + currTime() + "] ["+info.level.toUpperCase()+"] " + `${info.message.replace(removeRegEx,"")}`;}))})
    ]
});

var firstStart = true;
function checkInitServer () {
  for (i in config.servers) {
    if (servers[config.servers[i].uid] == null) return;
  }
  //Configs are all loaded and sockets setup, will now start
  if (firstStart) firstStart = false;
  else return;
  logger.info("Created all startup instances");
  startAll();
}

var startServerErr = {'-1': "Server process already running", '-2': "Server already starting", '-3': "Cannot start, server currently shutting down", '-4': "Server is disabled"};
function startServer () {
  if (this.objectType != "server") return console.trace();
  if (this.proc != null) return -1;
  if (this.startInProg != null) return -2;
  if (this.shutdownInProg != null) return -3;
  if (this.config.disabled) return -4;

  this.uptime = new Date().getTime();

  logger.info("Starting " + this.name);
  this.logger.verbose("Server is starting");

  this.ready = false;
  this.players = null;
  this.checkTimeouts = 0;
  if (this.restartOnRoundRestart != null) delete this.restartOnRoundRestart;

  var cwd = path.parse(config.SCPExecutable).dir;
  var base = path.parse(config.SCPExecutable).base;
  var child = spawn((isWin ? "" : "./") + base, ["-batchmode", "-nographics", "-nodedicateddelete", "-port"+this.config.p, "-console"+this.server.port, "-id"+process.pid], {cwd: cwd});

  if (config.logStdio) child.stdout.on('data', onServerStdout.bind(this));
  child.stderr.on('data', onServerStderr.bind(this));

  child.on('error', function (err) {
    logger.error("Error launching server, check your executable!\n", err);
    this.logger.verbose("Server Executable Error\n", err);
  });

  child.on('exit', function (code, signal) {
    this.logger.info(chalk.red("Server Process Exited with code:"), code, "Signal:", signal);
    this.proc = null;
    delete this.players;
    delete this.roundStartTime;
    var handled = false;
    if (this.checkInt != null) {
      clearInterval(this.checkInt);
      delete this.checkInt;
      if (this.checkInProg != null) {
        clearTimeout(this.checkInProg);
        delete this.checkInProg;
      }
    }
    if (this.uptime != null) delete this.uptime;
    if (this.startInProg != null && this.shutdownInProg == null) {
      logger.verbose(this.name, "Exited during startup. Check the executable and logs and verify the server is functional. If your using mods you might need to update or patch.")
      this.logger.warn("Process exited during startup. Check the executable and logs and verify the server is functional. If your using mods you might need to update or patch.")
      clearTimeout(this.startInProg);
      delete this.startInProg;
      handled = true;
    }
    if (this.forceRest) {
      delete this.forceRest;
      this.logger.info(chalk.green("Killed Successfully"));
      this.start();
      handled = true;
    }
    if (this.restartInProg != null) {
      clearTimeout(this.restartInProg);
      delete this.restartInProg;
      this.logger.info("Server Killed");
      this.start();
      handled = true;
    }
    if (this.forceKill) {
      delete this.forceKill;
      this.logger.info("Process Killed Successfully");
      handled = true;
    }
    if (this[events[22]]) {
      delete this[events[22]];
      this.logger.info("Server Restart Event caught, restarting process");
      logger.verbose(this.name + " Restart Event caught, restarting process");
      if (this.restartInProg != null) {
        clearTimeout(this.restartInProg);
        delete this.restartInProg;
      }
      if (this.restartOnRoundRestart) {
        delete this.restartOnRoundRestart;
        this.logger.info("Round restart exit detected");
      }
      if (fullRestartInProg) {
        this.logger.info("Round restart rejected for full restart");
        checkServersForRestart();
      }
      if (!fullRestartInProg) this.start();
      handled = true;
    }
    if (this.restartOnRoundRestart) {
      delete this.restartOnRoundRestart;
      this.logger.info("Round restart exit detected");
      if (fullRestartInProg) {
        this.logger.info("Round restart rejected for full restart");
        checkServersForRestart();
      }
      if (!fullRestartInProg) this.start();
      handled = true;
    }
    if (this.shutdownInProg != null) {
      if (this.startInProg != null) {
        clearTimeout(this.startInProg);
        delete this.startInProg;
      }
      this.logger.info("Stopped Successfully");
      logger.verbose(this.name, "Stopped Successfully")
      clearTimeout(this.shutdownInProg);
      delete this.shutdownInProg;
      handled = true;
    }
    if (processExit) {
      checkServersStopped();
    }
    if (!handled) {
      this.logger.info("Server Process Unexpectedly Exited! Restarting..");
      logger.info(this.name, "Unexpectedly Exited! Restarting..");
      this.socket = null;
      this.start();
    }
  }.bind(this));

  this.proc = child;
  this.startInProg = setTimeout(this.startTimeout, config.serverStartTimeout*1000);
}

function onServerStdout (data) {
  var d = data.toString().split("\n");
  //for (i in d) if (d[i].trim() != "") console.log(chalk.yellow("[" + this.name +"] [STDOUT]"), d[i]);
  for (i in d) if (d[i].trim() != "") {
    /* Note log minimzation tries to remove common stdout logs that print every time the game starts to reduce logs.
     * Theres a good chance this may also remove certain game breaking errors from stdout. So please if your debugging the game
     * Please have this setting disabled in your config so you capture all stdout. By default stderr is NOT filtered */
    if (config.minimizeLog) {
      if (d[i].indexOf("The referenced script") > -1 && d[i].indexOf("on this Behaviour") > -1 && d[i].indexOf("is missing!") > -1) continue;
      if (d[i].indexOf("Filename:  Line: ") > -1) continue;
      if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) continue;
      if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) continue;
      if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) continue;
    }
    this.logger.verbose(d[i]);
  }
}

function onServerStderr (data) {
  var d = data.toString().split("\n");
  //for (i in d) if (d[i].trim() != "") console.log(chalk.red("[" + this.name +"] " + "[STDERR]"), d[i]);
  for (i in d) if (d[i].trim() != "") this.logger.warn(d[i]);
}

function startTimeout () {
  if (this.objectType != "server") return console.trace();
  logger.verbose(this.name + " start took too long, restarting");
  this.logger.warn("Server start took too long, restarting");
  this.forceRestart();
}

var forceStopErr = {'-1': "Server process not running"};
function forceStop () {
  if (this.objectType != "server") return console.trace();
  if (this.proc == null) return -1;
  logger.verbose(this.name + " Forced Shutdown Triggered");
  this.logger.info("Forced Shutdown Triggered");
  this.proc.kill(9);
  this.forceKill = true;
}

var stopErr = {'-1': "Server process not running", '-2': "Server process already shutting down"};
function stopServer () {
  if (this.objectType != "server") return console.trace();
  if (this.proc == null) return -1;
  if (this.shutdownInProg != null) return -2;
  this.stopping = true;
  logger.verbose(this.name + " Stopping...");
  this.logger.info("Server Stopping...");
  this.command("stop");
  this.shutdownInProg = setTimeout(this.shutdownTimeout, 20000);
}

function shutdownTimeout () {
  delete this.shutdownInProg;
  if (this.objectType != "server") return console.trace();
  logger.verbose(this.name + " shutdown took too long, killing..");
  this.logger.warn("Server shutdown took too long, killing..");
  this.forceStop();
}

var forceRestartErr = {'-1': "Restart already in progress"};
function forceRestart () {
  if (this.objectType != "server") return console.trace();
  if (this.restartInProg != null) return -1;
  logger.verbose("Forced " + this.name + " to Restart");
  this.logger.info("Forced Restart Triggered");
  this.forceRest = true;
  if (this.proc != null) {
    this.proc.kill(9);
    logger.verbose("Attempting forced restart 1");
  } else {
    startServer.bind(this)();
    logger.verbose("Attempting forced restart 2");
  }
}

var restartErr = {'-1': "Restart already in progress", '-2': "Server has not started yet", '-3': "Delayed restart already scheduled. Server currently active with players"};
function restartServer (override) {
  if (this.objectType != "server") return console.trace();
  if (this.restartInProg != null) return -1;
  if (this.startInProg != null) return -2;
  if (this.proc != null && this.ready && this.players != null && this.players > 0 && this.restartOnRoundRestart != null && !override) return -3;
  //logger.verbose(this.name, "Restarting...", this.ready, this.players);
  if (this.ready && this.proc != null) {
    if (this.players != null && this.players > 0 && !override) {
      this.command("rnr");
      logger.verbose(this.name + " Delayed Restart Requested");
      this.logger.info("Delayed Restart Requested");
    } else {
      this.command("sr");
      logger.verbose(this.name + " Silent Restarting");
      this.logger.info("Silent Restarting");
    }
    this.restartInProg = setTimeout(this.restartTimeout.bind(this,override), config.serverRestartReqTimeout * 1000);
  } else if (this.proc != null) {
    this.command("sr");
    this.restartInProg = setTimeout(this.restartTimeout.bind(this,override), config.serverRestartReqTimeout * 1000);
    logger.verbose(this.name + " Silent Restarting");
    this.logger.info("Silent Restarting");
  } else {
    startServer.bind(this)();
    logger.verbose("Restoring " + this.name + " from Offline State");
    this.logger.info("Restoring from Offline State");
  }
}

function restartTimeout (override) {
  if (this.objectType != "server") return console.trace();
  delete this.restartInProg;
  if (this.restartTimeouts == null) this.restartTimeouts = 0;
  this.restartTimeouts++;
  if (this.restartTimeouts > 3) {
    logger.verbose(this.name + " Restart Process timed out!");
    this.logger.warn("Server won't respond to restart requests, Restart Process timed out!");
    return this.forceRestart();
  }
  if (this.ready && this.proc != null) {
    if (this.players != null && this.players > 0 && !override) {
      this.command("rnr");
      logger.verbose(this.name + " Delayed Restart Requested");
      this.logger.info("Delayed Restart Requested");
    } else {
      this.command("sr");
      logger.verbose(this.name + " Silent Restarting");
      this.logger.info("Silent Restarting");
    }
    this.restartInProg = setTimeout(this.restartTimeout.bind(this,override), config.serverRestartReqTimeout * 1000);
  } else if (this.proc != null) {
    this.command("sr");
    this.restartInProg = setTimeout(this.restartTimeout.bind(this,override), config.serverRestartReqTimeout * 1000);
    logger.verbose(this.name + " Silent Restarting");
    this.logger.info("Silent Restarting");
  }
}

function checkServer () {
  if (this.objectType != "server") return console.trace();
  if (this.proc == null) return;
  if (!this.ready) return;
  if (this.checkInProg != null) return;
  this.command("list");
  this.checkInProg = setTimeout(this.checkTimeout, checkTimeouts);
}

var commandErr = {'-1': "Server socket not initialized"};
function processCommand (message) {
  if (this.objectType != "server") return console.trace();
  if (this.socket == null) return -1;
  message = message.trim();
  this.socket.write(Buffer.concat([toInt32(message.length), Buffer.from(message)]));
}

var checkTimeouts = 7500; //Amount of time for a server check to time out

function checkTimeout () {
  if (this.objectType != "server") return console.trace();
  if (this.proc == null) return;
  if (!this.ready) return;
  this.checkInProg = null;
  if (this.checkTimeouts == null) this.checkTimeouts = 0;
  this.checkTimeouts++;
  logger.verbose(this.name + " Timed out! - " + checkTimeouts*this.checkTimeouts/1000);
  this.logger.warn("Server response timeout! - " + checkTimeouts*this.checkTimeouts/1000);
  if (this.checkTimeouts >= 4) {
    logger.verbose(this.name + " presumed dead! Restarting..");
    this.logger.warn("Server presumed dead! Restarting..");
    this.ready = false;
    this.forceRestart();
  }
}

var memVal = false;

async function checkMemory () {
  //logger.verbose(Math.round(os.freemem() / os.totalmem() * 100) + "%");
  //If system has less than or equal to 100MB of free memory, investigate
  if (os.freemem() <= 500000000 && memVal == false) {
    memVal = true;
    var s = [];
    var SCPSLTotal = 0;
    for (i in servers) {
      var server = servers[i];
      if (server.proc != null && !server.restartOnRoundRestart && !server.restartInProg && !server.forceRest && !server.shutdownInProg && !server.forceKill && !server.startInProg) {
        const stats = await pidusage(server.proc.pid);
        logger.verbose(stats)
        SCPSLTotal += stats.memory;
        s.push({uid: server.uid, bytes: stats.memory, used: Math.round(stats.memory/(os.totalmem()-os.freemem())*100)});
      }
    }
    if (s.length > 0) {
      s.sort(function (a,b){return b.bytes-a.bytes});
      logger.info(s);

      logger.info("Combined Usage:", Math.round(SCPSLTotal/(os.totalmem()-os.freemem())*100) + "%")

      //If SCPSL servers are using a majority of system memory
      if (Math.round(SCPSLTotal/(os.totalmem()-os.freemem())*100) > 50) {
        logger.warn(chalk.red("!WARNING! System free memory is less than 100MB, evaluating servers memory usage"));
        //if SL server is contributing a significant amount of system usage
        if (s[0].used > 50/s.length) {
          logger.warn(chalk.yellow("Server using a majority of overall memory will be restarted complying to silent restart restrictions to compensate"));
          servers[s[0].uid].restart();
        } else {
          logger.warn(chalk.cyan("Server memory usage appears normal, please ensure your system has enough memory to support this load, tread carefully from this point."));
        }
      } else {
        logger.warn(chalk.red("!WARNING! System free memory is less than 100MB, check system memory usage"));
      }
    }
    memVal = false;
  }
}

//If you want to disable daily restarts, just set hours to a negative number in your config
async function checkTime () {
  empt();
  if (new Date().getHours() != config.restartTime.hours || new Date().getMinutes() != config.restartTime.minutes) return;
  var date = ((new Date().getMonth()) + "-" + (new Date().getDate()));
  for (i in servers) {
    var server = servers[i];
    if (!server.config.disabled && server.players != null && server.players > 0 && emptyTime > 0) emptyTime = 0;
    if (server.lastRestart != date && !server.config.disabled) {
      logger.verbose(server.name, "Scheduled Server Restart");
      server.logger.info(chalk.cyan("Scheduled Restart in progress"));
      server.lastRestart = date;
      server.restart();
    }
  }
  emptyTime += 5;
}

function empt () {
  for (i in servers) {
    var server = servers[i];
    if (!server.config.disabled && server.players != null && server.players > 0 && emptyTime > 0) emptyTime = 0;
  }
  emptyTime += 5;
  if (emptyTime >= 60 && triggerFullRestart) {
    emptyTime = 0;
    fullRestart();
  }
}

var triggerFullRestart = false;
var emptyTime = 0;

function handleServerEvent (code) {
  if (this.objectType != "server") return console.trace();
  if (code == 16) {
    if (this.startInProg != null) {
      clearTimeout(this.startInProg);
      delete this.startInProg;
      this.logger.info("Started Successfully");
      logger.verbose(this.name, "Started Successfully");
    }
    this.ready = true;
    delete this.roundStartTime;
    if (this.checkInt == null) this.checkInt = setInterval(this.check, config.checkinTime*1000);
    this.check();
  } else if (code == 22) {
    this[events[code]] = true;
    if (this.restartInProg) {
      clearTimeout(this.restartInProg);
      delete this.restartInProg;
      if (!fullRestartInProg) this.restartOnRoundRestart = true;
    }
  } else if (code == 19) {
    if (this.restartInProg) {
      this.command("rnr");
    }
  }
}

function handleServerMessage (m) {
  if (this.checkInProg != null && m.indexOf("List of players") > -1) {
    var players = m.substring(m.indexOf("List of players")+17, m.indexOf("List of players")+17+m.substring(m.indexOf("List of players")+17).indexOf(")"));
    players = parseInt(players);
    if (isNaN(players)) players = null;
    this.players = players;
    this.checkTimeouts = 0;
    clearTimeout(this.checkInProg);
    this.checkInProg = null;
  } else if (this.restartInProg != null && m.indexOf("Server WILL restart after next round.") > -1) {
    clearTimeout(this.restartInProg);
    delete this.restartInProg;
    this.restartOnRoundRestart = true;
    this.logger.info(m.trim());
  }
}

function startAll () {
  logger.info("Starting All Enabled Servers");
  for (i in servers) servers[i].start();
}

function createSocket () {
  return new Promise(function(resolve, reject) {
    var server = new Net.Server();
    server.listen(0, function(resolve) {
      const address = server.address();
      server.port = address.port;
      logger.verbose("Socket created on", server.port);
      resolve(server);
    }.bind(null, resolve));
    setTimeout(function (reject) {reject("Socket took too long to open")}.bind(null, reject), 1000);
  });
}

function onSocket (socket) {
  if (this.objectType != "server") return console.trace();
  if (socket.remoteAddress != "127.0.0.1" && socket.remoteAddress != "::ffff:127.0.0.1") return socket.end();
  if (this.socket != null) return;
  logger.info(this.name, "Socket Connected");
  this.socket = socket;
  socket.on("data", consoleMessage.bind(this));
  socket.on('end', onSocketEnd.bind(this));
  socket.on('error', onSocketError.bind(this));
}

function onSocketEnd () {
  if (this.objectType != "server") return console.trace();
  this.socket = null;
}

function onSocketError (e) {
  if (this.objectType != "server") return console.trace();
  try {
    this.socket.end();
  } catch (e) {
    //Nah'
  }
  this.socket = null;
}

function consoleMessage (chunk) {
  if (this.objectType != "server") return console.trace();
  let data = [...chunk]
    while (data.length > 0) {
      let code = parseInt(data.shift())
      if (code >= 16) {
        // handle control code
        this.logger.info(chalk.yellow("Event Fired: " + events[code.toString()]));
        this.handleServerEvent(code);
      } else if (code != 0) {
        let length = (data.shift() << 24) | (data.shift() << 16) | (data.shift() << 8) | data.shift()
        let m = data.splice(0, length)
        let message = "";
        for (let i = 0; i < m.length; i++) message += String.fromCharCode(m[i])
        if (colors[code]) message = colors[code](message)
        if (message.trim() == colors[code]("New round has been started.")) this.roundStartTime = new Date().getTime();
        if (this.checkInProg != null && message.indexOf("List of players") > -1) {
          this.tempListOfPlayersCatcher = true;
          return this.handleServerMessage(message);
        }
        if (this.tempListOfPlayersCatcher) message = message.replaceAll("\n*\n", "*");
        if (this.tempListOfPlayersCatcher && message.indexOf(":") > -1 && (message.indexOf("@") > -1 || message.indexOf("(no User ID)")) && message.indexOf("[") > -1 && message.indexOf("]") > -1 && (message.indexOf("steam") > -1 || message.indexOf("discord") > -1 || message.indexOf("(no User ID)") > -1)) {
          return;
        } else if (this.tempListOfPlayersCatcher) delete this.tempListOfPlayersCatcher;
        if (message.indexOf("Server WILL restart after next round.") > -1 && this.restartInProg != null) return this.handleServerMessage(message);
        if (message.charAt(0) == "\n") message = message.substring(1,message.length);
        if (message.indexOf("Welcome to") > -1 && message.length > 1000) message = colors[code]("Welcome to EXILED (ASCII Cleaned to save your logs)");
        this.logger.info(message.trim());
      }
    }
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

function cleanInput (args) {
  args = args.trim();
  args = args.split(" ");
  var temp = {};
  for (i in args) temp[i] = args[i].trim();
  args = [];
  for (i in temp) if (temp[i] != "") args.push(temp[i]);
  return args
}

function getServer (hint) {
  if (servers[hint] != null) {
    return servers[hint];
  } else {
    for (i in servers) {
      if (servers[i].name.indexOf(hint) > -1) {
        return servers[i];
      } else if (servers[i].config.p == hint) {
        return servers[i];
      }
    }
  }
}

function checkConfig (conf) {
  //Returns bool, to be implimented further
  if (!fs.existsSync(conf.logFolder)) {
    try {
      fs.mkdirSync(conf.logFolder);
    } catch (e) {
      return "Config Log File error, Could not create log file folder";
    }
  }
  if (conf.SCPExecutable == null) {
    return "SCP Executable not specified";
  } else if (!fs.existsSync(conf.SCPExecutable)) {
    return "SCP Executable not found";
  }

  return true;
}

function reloadConfig () {
  var oldConfig = config;
  if (fs.existsSync(configPath)) {
    var pre;
    var rawdata = fs.readFileSync(configPath);
    try {
      pre = JSON.parse(rawdata);
    } catch (e) {
      logger.warn("Error reading config, no changes applied", e);
    }
    var check = checkConfig(pre);
    if (check != true) {
      logger.warn(chalk.red("Error in config file, no changes applied:", check));
      return;
    }
    config = pre;
  } else {
    logger.warn("configs not found!")
    process.exit(0);
  }
  for (i in config.servers) if (servers[config.servers[i].uid] == null) createServer(i);
  var marked = [];
  for (i in servers) {
    var test = false;
    for (x in config.servers) if (config.servers[x].uid == servers[i].uid) {
      test = true;
      if (servers[i].config.p != config.servers[x].p && servers[i].proc != null) logger.info(chalk.yellow("Warning: You have changed the port number for " + servers[i].name + ", this change will not be applied until you restart the server."));
      servers[i].config = config.servers[x];
      if (servers[i].config.disabled && servers[i].proc != null) {
        logger.info(servers[i].name + " was disabled via the new config file, applying change..");
        servers[i].stop();
      }
      break;
    }
    if (test) continue;
    else {
      marked.push(servers[i]);
    }
  }
  if (marked.length > 0) {
    logger.warn(chalk.yellow("Warning: Active server(s) is missing from config. Is this a mistake? Check server UIDs in your config"));
    for (i in marked) logger.warn(chalk.yellow("UID: " + marked[i].config.uid, "Label: " + marked[i].name, "Port: " + marked[i].config.p));
  }

  //if logging setting change
  if (oldConfig.logFolder != config.logFolder || oldConfig.loggingMaxDays != config.loggingMaxDays || oldConfig.loggingMaxSize != config.loggingMaxSize) {
    logger.info("Logging system reconfiguring...")
    for (i in servers) {
      var server = servers[i];
      server.logger = newServerTransport(server);
      server.logger.verbose("\n\n--- These lines intentionally left bank to help identify logging start ---\n");
      server.logger.info(chalk.red("Logging Start"));
    }
    logger = winston.createLogger({
        transports: [
          new winston.transports.Console({ level: 'info', format: winston.format.combine(Form(), winston.format.printf((info) => {return "[" + currTime2() + "] " + `${info.message}`;}))}),
          new winston.transports.DailyRotateFile({ level: 'verbose', frequency: '24h', datePattern: 'YYYY-MM-DD', filename: path.join(config.logFolder, 'Main-%DATE%.log'), maxsize: config.loggingMaxSize, maxFiles: config.loggingMaxDays, tailable: true, format: winston.format.combine(Form(), winston.format.printf((info) => {return "[" + currTime() + "] ["+info.level.toUpperCase()+"] " + `${info.message.replace(removeRegEx,"")}`;}))})
        ]
    });
  }

  //if checkinTime change, redo the intervals
  if (oldConfig.checkinTime != config.checkinTime) {
    logger.info("Server check Intervals rebuilding..")
    for (i in servers) {
      var server = servers[i];
      if (server.checkInt != null) {
        clearInterval(server.checkInt);
        server.checkInt = setInterval(server.check, config.checkinTime*1000);
        if (server.checkInProg) {
          clearTimeout(checkInProg);
          checkInProg = null;
        }
        server.check();
      }
    }
  }

  if (config.memoryChecker && memoryInt == null) memoryInt = setInterval(checkMemory, 60000);
  if (configureRestarts(config.restartRate) == -1) logger.warn(chalk.red("Warning: ")+"restartRate value in config is invalid, check your config.");

  logger.info(chalk.green("Configuration reloaded!"));
}

//Translates time strings to minutes
function translateTimeString (s) {
	s = s.toLowerCase();
	var mult;
	var str;
	if (s.indexOf("h") > -1) {
		s = parseInt(s.replace("h", ""));
		mult = 60;
		if (isNaN(s)) return -1;
		str = s;
		if (s>1) str += " hours";
		else str += " hour";
	} else if (s.indexOf("mon") > -1) {
		//Months, not minutes
		s = parseInt(s.replace("mon", ""));
		if (isNaN(s)) return -1;
		mult = 43800;
		str = s;
		if (s>1) str += " months";
		else str += " month";
	} else if (s.indexOf("m") > -1) {
		s = parseInt(s.replace("m", ""));
		if (isNaN(s)) return -1;
		mult = 1;
		str = s;
		if (s>1) str += " minutes";
		else str += " minute";
	} else if (s.indexOf("d") > -1) {
		s = parseInt(s.replace("d", ""));
		if (isNaN(s)) return -1;
		mult = 1440;
		str = s;
		if (s>1) str += " days";
		else str += " day";
	} else if (s.indexOf("y") > -1) {
		s = parseInt(s.replace("y", ""));
		if (isNaN(s)) return -1;
		mult = 525600;
		str = s;
		if (s>1) str += " years";
		else str += " year";
	} else {
		return -1;
	}
	return {min: s * mult, str: str};
}

//rate: false || null == disabled
function configureRestarts (rate) {
  if (rate == false || rate == null) {
    if (restartInt != null) {
      clearInterval(restartInt);
      restartInt = null;
      logger.info(chalk.cyan("Interval Based Restarts Disabled"));
    }
    return;
  }
  if (rate == "") {
    if (restartInt != null) {
      clearInterval(restartInt);
      restartInt = null;
      logger.info(chalk.cyan("Interval Based Restarts Disabled"));
    }
    return -1; //Invalid input
  }
  rate = translateTimeString(rate);
  if (rate == -1) {
    if (restartInt != null) {
      clearInterval(restartInt);
      restartInt = null;
      logger.info(chalk.cyan("Interval Based Restarts Disabled"));
    }
    return -1; //Invalid input
  }
  logger.info(chalk.cyan("Server restart interval set for " + rate.str))
  restartInt = setInterval(function () {
    var date = ((new Date().getMonth()) + "-" + (new Date().getDate()));
    for (i in servers) {
      var server = servers[i];
      if (!server.config.disabled) {
        logger.verbose(server.name, "Interval Server Restart");
        server.logger.info(chalk.cyan("Interval Restart in progress"));

        //If the servers are being restarted by this, you probably don't want the daily restart code running too
        server.lastRestart = date;
        server.restart();
      }
    }
  }, rate.min*1000*60);
}

//ToDo:
//Add isolate and unisolate command which will isolate server console output to specific servers
//add help command ffs
//add startup params for specifying a config file to use -- needs doc
//allow changing the server timeout with Configs

//all start and stop commands are designed to fully succeed in their task
//which means hard or soft, the server is going to stop and or restart when you ask it to
function evaluate (args) {
  args = cleanInput(args);
  if (args.length == 0) return;
  var command = args.shift();
  if (command == "stop") {
    if (args[0] == null) return console.log("Usage: stop <server label|UID|port>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (server.config.disabled || server.proc == null) return console.log(server.name, "is already stopped");
    server.logger.verbose("Server Stopped by console");
    logger.info("Console stopped", server.name);
    var resp = server.stop();
    if (resp != null) return console.log("Stop failed: " + stopErr[resp]);
  } else if (command == "start") {
    if (args[0] == null) return console.log("Usage: start <server label|UID|port>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (server.config.disabled) return console.log(server.name, "is disabled and cannot be started. Check config or enable it");
    if (server.proc != null) return console.log("Server already active!");
    server.logger.verbose("Server Started by console");
    logger.info("Console started", server.name);
    var resp = server.start();
    if (resp != null) return console.log("Start failed: " + startServerErr[resp]);
  } else if (command == "restartforce" || command == "rf" || command == "fr") {
    if (args[0] == null) return console.log("Usage: restartforce <server label|UID|port>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (server.config.disabled) return console.log(server.name, "is disabled and cannot be started. Check config or enable it");
    server.logger.verbose("Server Forcibly Restarted by console");
    logger.info("Console command forcibly restarted", server.name);
    var resp = server.restart(true);
    if (resp != null) return console.log("Restart failed: " + restartErr[resp]);
  } else if (command == "restart") {
    if (args[0] == null) return console.log("Usage: restart <server label|UID|port>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (server.config.disabled) return console.log(server.name, "is disabled and cannot be started. Check config or enable it");
    server.logger.verbose("Server Restarted by console");
    logger.info("Console command restarted", server.name);
    var resp = server.restart();
    if (resp != null) return console.log("Restart failed: " + restartErr[resp]);
  } else if (command == "enable") {
    if (args[0] == null) return console.log("Usage: enable <server label|UID|port>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (!server.config.disabled) return console.log(server.name, "is already enabled!");
    server.config.disabled = false;
    server.logger.verbose("Server Enabled");
    console.log("Enabled server", server.name);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
  } else if (command == "disable") {
    if (args[0] == null) return console.log("Usage: disable <server label|UID|port>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (server.config.disabled) return console.log(server.name, "is already disabled!");
    server.config.disabled = true;
    server.logger.verbose("Server Disabled");
    if (server.proc) server.stop();
    console.log("Disabled server", server.name);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
  } else if (command == "exec" || command == "run") {
    if (args[0] == null && args[1] == null) return console.log("Usage: exec/run <server label|UID|port> <command>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (server.proc == null) return console.log("Server not running!");
    args.shift() //remove the server hint
    args = args.join(" ");
    console.log("Sending command " + chalk.green(args) + " to " + server.name);
    server.logger.verbose("Command sent by console: " + args);
    var resp = server.command(args);
    if (resp != null) return console.log("Command failed: " + commandErr[resp]);
  } else if (command == "quit" || command == "exit") {
    quit();
  } else if (command == "startAll" || command == "sa") {
    logger.info("Console started all servers");
    startAll();
  } else if (command == "stopAll" || command == "sta") {
    logger.info("Console stopped all servers");
    for (i in servers) servers[i].stop();
  } else if (command == "restartAll" || command == "ra") {
    logger.info("Console restarted all servers");
    for (i in servers) if (!servers[i].config.disabled) servers[i].restart();
  } else if (command == "enableAll" || command == "ea") {
    logger.info("Console enabled all servers");
    for (i in servers) servers[i].config.disabled = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
  } else if (command == "disableAll" || command == "da") {
    logger.info("Console disabled all servers");
    for (i in servers) {
      servers[i].config.disabled = true;
      if (servers[i].proc != null) servers[i].stop();
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
  } else if (command == "reload") {
    logger.info("Reloading Config...");
    reloadConfig();
  } else if (command == "list") {
    var current = new Date().getTime();
    console.log(chalk.yellow("Server List:"));
    for (i in servers) console.log("["+(servers[i].proc != null ? chalk.green("ACTIVE") : (servers[i].config.disabled ? chalk.red("DISABLED") : chalk.red("INACTIVE")))+"]\t" + chalk.cyan(servers[i].name + " - " + servers[i].config.p + (servers[i].players != null ? (" - " + servers[i].players + " Players") : "") + (servers[i].proc != null && servers[i].uptime != null ? " - Uptime: " + Math.floor((current - servers[i].uptime)/1000).toString().toHHMMSS() : "") + (servers[i].roundStartTime != null ? " - Round Time: " + (Math.floor((current - servers[i].roundStartTime)/1000).toString().toHHMMSS()) : "")));
  } else if (command == "version" || command == "v") {
    console.log("Running NVLA - " + version);
  } else if (command == "fullRestart" || command == "fullr") {
    var inst = true;
    for (i in servers) {
      var server = servers[i];
      if (server.proc != null) inst = false;
    }
    if (inst) return fullRestart();
    triggerFullRestart = !triggerFullRestart;
    if (triggerFullRestart) console.log("Full restart will be triggered when servers are inactive");
    else console.log("Full restart cancelled");
  } else if (command == "forceFullRestart" || command == "ffullr") {
    console.log("Forcing full restart of program..");
    fullRestart();
  } else {
    console.log("Unknown Command: " + chalk.green(command));
  }
}

var fullRestartInProg = false;

function fullRestart () {
  if (fullRestartInProg) return;
  console.log("Triggering full restart");
  fullRestartInProg = true;
  for (i in servers) {
    var server = servers[i];
    if (server.proc != null) server.restart(true);
  }
  checkServersForRestart();
}

function checkServersForRestart () {
  var check = true;
  for (i in servers) {
    var server = servers[i];
    if (server.proc != null) {
      check = false;
      break;
    }
  }
  if (check) {
    if (config.respawnOnFullRestart) {
      if (process.pkg) {
        var replacement = spawn(process.execPath, [process.argv[1]].concat(process.argv.slice(2)), {shell: process.stdin.isTTY, detached: true});
        replacement.unref();
      } else {
        var replacement = spawn(process.execPath, [process.argv[1]].concat(process.argv.slice(2)), {detached: true});
        replacement.unref();
      }
    }
    setTimeout(quit, 1000);
  }
}

var exiting = false;
function quit () {
  if (exiting) return
  stdin.pause();
  exiting = true;
  console.log(chalk.yellow("Process exiting.."));
  for (i in servers) servers[i].stop();
  clearInterval(updateInt);
  clearInterval(memoryInt);
  processExit = true;
  checkServersStopped();
}

process.on('SIGINT', quit);
process.on('SIGQUIT', quit);

String.prototype.toHHMMSS = function () {
    var sec_num = parseInt(this, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

function checkServersStopped () {
  if (processExit) {
    var test = true;
    for (i in servers) if (servers[i].proc != null) {
      test = false;
      break;
    }
    if (test) {
      process.exit(0);
    }
  }
}

var processExit = false;

var stdin = process.openStdin();
stdin.addListener("data", function(d) {
	var test = d.toString();
	try {
		evaluate(test);
	} catch (e) {
		console.log("Failed user input: ", e);
	}
});
console.log("Welcome to "+chalk.green("NotVeryLocalAdmin")+" v"+version+", console is ready");
logger.info(chalk.cyan("NotVeryLocalAdmin Logging Started"));

var updateInt, memoryInt, restartInt;

for (i in config.servers) createServer(i);
updateInt = setInterval(checkTime, 5000); //Time checked every 5 seconds
if (config.memoryChecker) memoryInt = setInterval(checkMemory, 60000); //Memory is checked every minute
if (configureRestarts(config.restartRate) == -1) logger.warn(chalk.red("Warning: ")+"restartRate value in config is invalid, check your config.");

process.on('uncaughtException', function(err) {
  fs.writeFileSync('crashLog.txt', err.stack + "\n" + err.message);
  setTimeout(process.exit.bind(null, -1), 100);
  logger.error("ERROR", err);
});
