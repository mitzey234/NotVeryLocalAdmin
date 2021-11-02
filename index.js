#!/usr/bin/env node
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

var config;

var isWin = os.platform() == "win32";

if (fs.existsSync('config.json')) {
  var rawdata = fs.readFileSync('config.json');
  try {
    config = JSON.parse(rawdata);
  } catch (e) {
    console.log("Error reading config", e);
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
  o.logger.info(chalk.red("Logging Start"));
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

function checkInitServer () {
  for (i in config.servers) {
    if (servers[config.servers[i].uid] == null) return;
  }
  //Configs are all loaded and sockets setup, will now start
  startAll();
}

var startServerErr = {'-1': "Server process already running", '-2': "Server already starting", '-3': "Cannot start, server currently shutting down", '-4': "Server is disabled"};
function startServer () {
  if (this.objectType != "server") return;
  if (this.proc != null) return -1;
  if (this.startInProg != null) return -2;
  if (this.shutdownInProg != null) return -3;
  if (this.config.disabled) return -4;

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
    logger.error("Error launching server, check your executable!\n", e);
    this.logger.verbose("Server Executable Error\n", e);
  });

  child.on('exit', function (code, signal) {
    this.logger.info(chalk.red("Server Process Exited with code:"), code, "Signal:", signal);
    this.proc = null;
    var handled = false;
    if (this.startInProg != null && this.shutdownInProg == null) {
      logger.verbose(this.name, "Exited during startup. Check the executable and logs and verify the server is functional. If your using mods you might need to update or patch.")
      this.logger.warn("Process exited during startup. Check the executable and logs and verify the server is functional. If your using mods you might need to update or patch.")
      clearTimeout(this.startInProg);
      delete this.startInProg;
      handled = true;
    }
    if (this.checkInt != null) {
      clearInterval(this.checkInt);
      this.checkInt = null;
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
      this.start();
      handled = true;
    }
    if (this.restartOnRoundRestart) {
      delete this.restartOnRoundRestart;
      this.logger.info("Round restart exit detected");
      this.start();
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
  if (this.objectType != "server") return;
  logger.verbose(this.name + " start took too long, restarting");
  this.logger.warn("Server start took too long, restarting");
  this.forceRestart();
}

var forceStopErr = {'-1': "Server process not running"};
function forceStop () {
  if (this.objectType != "server") return;
  if (this.proc == null) return -1;
  logger.verbose(this.name + " Forced Shutdown Triggered");
  this.logger.info("Forced Shutdown Triggered");
  this.proc.kill(9);
  this.forceKill = true;
}

var stopErr = {'-1': "Server process not running", '-2': "Server process already shutting down"};
function stopServer () {
  if (this.objectType != "server") return;
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
  if (this.objectType != "server") return;
  logger.verbose(this.name + " shutdown took too long, killing..");
  this.logger.warn("Server shutdown took too long, killing..");
  this.forceStop();
}

var forceRestartErr = {'-1': "Restart already in progress"};
function forceRestart () {
  if (this.objectType != "server") return;
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
  if (this.objectType != "server") return;
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
    this.restartInProg = setTimeout(this.restartTimeout, config.serverRestartReqTimeout * 1000);
  } else if (this.proc != null) {
    this.command("sr");
    this.restartInProg = setTimeout(this.restartTimeout, config.serverRestartReqTimeout * 1000);
    logger.verbose(this.name + " Silent Restarting");
    this.logger.info("Silent Restarting");
  } else {
    startServer.bind(this)();
    logger.verbose("Restoring " + this.name + " from Offline State");
    this.logger.info("Restoring from Offline State");
  }
}

function restartTimeout () {
  if (this.objectType != "server") return;
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
    this.restartInProg = setTimeout(this.restartTimeout, config.serverRestartReqTimeout * 1000);
  } else if (this.proc != null) {
    this.command("sr");
    this.restartInProg = setTimeout(this.restartTimeout, config.serverRestartReqTimeout * 1000);
    logger.verbose(this.name + " Silent Restarting");
    this.logger.info("Silent Restarting");
  }
}

function checkServer () {
  if (this.objectType != "server") return;
  if (this.proc == null) return;
  if (!this.ready) return;
  if (this.checkInProg != null) return;
  this.command("list");
  this.checkInProg = setTimeout(this.checkTimeout, 10000);
}

var commandErr = {'-1': "Server socket not initialized"};
function processCommand (message) {
  if (this.objectType != "server") return;
  if (this.socket == null) return -1;
  message = message.trim();
  this.socket.write(Buffer.concat([toInt32(message.length), Buffer.from(message)]));
}

function checkTimeout () {
  if (this.objectType != "server") return;
  if (this.proc == null) return;
  if (!this.ready) return;
  this.checkInProg = null;
  if (this.checkTimeouts == null) this.checkTimeouts = 0;
  this.checkTimeouts++;
  if (this.checkTimeouts > 3) {
    logger.verbose(this.name + " presumed dead! Restarting..");
    this.logger.warn("Server presumed dead! Restarting..");
    this.ready = false;
    this.restart();
  }
}

var memVal = false;

async function checkMemory () {
  //logger.verbose(Math.round(os.freemem() / os.totalmem() * 100) + "%");
  //If system has less than or equal to 100MB of free memory, investigate
  if (os.freemem() <= 100000000 && memVal == false) {
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
  if (new Date().getHours() != config.restartTime.hours || new Date().getMinutes() != config.restartTime.minutes) return;
  var date = ((new Date().getMonth()) + "-" + (new Date().getDate()));
  for (i in servers) {
    var server = servers[i];
    if (server.lastRestart != date && !server.config.disabled) {
      logger.verbose(server.name, "Scheduled Server Restart");
      server.logger.info(chalk.cyan("Scheduled Restart in progress"));
      server.lastRestart = date;
      server.restart();
    }
  }
}

function handleServerEvent (code) {
  if (this.objectType != "server") return;
  if (code == 16) {
    if (this.startInProg != null) {
      clearTimeout(this.startInProg);
      delete this.startInProg;
      this.logger.info("Started Successfully");
      logger.verbose(this.name, "Started Successfully");
    }
    this.ready = true;
    if (this.checkInt == null) setInterval(this.check, config.checkinTime*1000);

  } else if (code == 22) {
    this[events[code]] = true;
    if (this.restartInProg) {
      clearTimeout(this.restartInProg);
      delete this.restartInProg;
      this.restartOnRoundRestart = true;
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

for (i in config.servers) createServer(i);

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
  if (this.objectType != "server") return;
  if (socket.remoteAddress != "127.0.0.1" && socket.remoteAddress != "::ffff:127.0.0.1") return socket.end();
  if (this.socket != null) return;
  logger.info(this.name, "Socket Connected");
  this.socket = socket;
  socket.on("data", consoleMessage.bind(this));
  socket.on('end', onSocketEnd.bind(this));
  socket.on('error', onSocketError.bind(this));
}

function onSocketEnd () {
  if (this.objectType != "server") return;
  this.socket = null;
}

function onSocketError (e) {
  if (this.objectType != "server") return;
  try {
    this.socket.end();
  } catch (e) {
    //Nah'
  }
  this.socket = null;
}

function consoleMessage (chunk) {
  if (this.objectType != "server") return;
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

        if (message.indexOf("List of players") > -1 && this.checkInProg != null) {
          this.tempListOfPlayersCatcher = true;
          return this.handleServerMessage(message);
        }
        if (this.tempListOfPlayersCatcher && message.indexOf("-") > -1 && message.indexOf("@") > -1 && message.indexOf("[") > -1 && message.indexOf("]") > -1 && (message.indexOf("steam") > -1 || message.indexOf("discord") > -1)) {
          return;
        } else if (this.tempListOfPlayersCatcher) delete this.tempListOfPlayersCatcher;
        if (message.indexOf("Server WILL restart after next round.") > -1 && this.restartInProg != null) return this.handleServerMessage(message);
        if (message.charAt(0) == "\n") message = message.substring(1,message.length);
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

//all start and stop commands are designed to fully sucessed in their task
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
    fs.writeFileSync('config.json', JSON.stringify(config, null, 4));
  } else if (command == "disable") {
    if (args[0] == null) return console.log("Usage: disable <server label|UID|port>");
    var server = getServer(args[0]);
    if (server == null) return console.log("Server not found");
    if (server.config.disabled) return console.log(server.name, "is already disabled!");
    server.config.disabled = true;
    server.logger.verbose("Server Disabled");
    if (server.proc) server.stop();
    console.log("Disabled server", server.name);
    fs.writeFileSync('config.json', JSON.stringify(config, null, 4));
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
    for (i in servers) servers[i].restart();
  } else if (command == "enableAll" || command == "ea") {
    logger.info("Console enabled all servers");
    for (i in servers) servers[i].config.disabled = false;
    fs.writeFileSync('config.json', JSON.stringify(config, null, 4));
  } else if (command == "disableAll" || command == "da") {
    logger.info("Console disabled all servers");
    for (i in servers) {
      servers[i].config.disabled = true;
      if (servers[i].proc != null) servers[i].stop();
    }
    fs.writeFileSync('config.json', JSON.stringify(config, null, 4));
  }
}

function quit () {
  console.log(chalk.yellow("Process exiting3.."));
  for (i in servers) servers[i].stop();
  clearInterval(updateInt);
  clearInterval(memoryInt);
  processExit = true;
  checkServersStopped();
}

process.on('SIGINT', quit);
process.on('SIGQUIT', quit);

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

updateInt = setInterval(checkTime, 5000); //Time checked every 5 seconds
if (config.memoryChecker) memoryInt = setInterval(checkMemory, 60000); //Memory is checked every minute
console.log("Welcome to "+chalk.green("NotVeryLocalAdmin")+" V1.0.1, console is ready");
logger.info(chalk.cyan("NotVeryLocalAdmin Logging Started"));
