/* eslint-disable no-empty */
const classes = require("./classes");
const chalk = require("chalk");
const fs = require("fs");
const {spawn} = require("child_process");
const pack = require("./package.json");

let args = process.argv.filter(i => i.trim() != "");

try {
    if (args.includes("-child")) process.send({type: "ready"});
} catch {}

let NVLA = new classes.NVLA;
NVLA.restart = restart;
NVLA.shutdown = quit;
NVLA.start(args.includes("-d"));

process.on('uncaughtException', function(err) {
    if (err.message.indexOf("ECONNRESET") > -1) {
        console.error("This FUCKKING ERROR", err);
        console.trace();
        var stack = new Error().stack;
        fs.writeFileSync('crashLog.txt', err.stack + "\n" + err.message + "\n" + stack);
        return;
    }
    fs.writeFileSync('crashLog.txt', err.stack + "\n" + err.message);
    setTimeout(process.exit.bind(null, -1), 100);
    console.error("ERROR", err);
});

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

function getServer (hint) {
    if (NVLA.servers.has(hint)) {
        return NVLA.servers.get(hint);
    } else {
        let server;
        NVLA.servers.forEach((s) => {
            if (s.config.label == hint || s.config.label.indexOf(hint) > -1) server = s;
        });
        if (server != null) return server;
        NVLA.servers.forEach((s) => {
            if (s.config.port == hint) server = s;
        });
        if (server != null) return server;
    }
}

async function evaluate(args) {
    args = cleanInput(args);
    if (args.length == 0) return;
    var command = args.shift();
    if (command == "stop") {
        if (args[0] == null) return console.log("Usage: stop <Server label|UID|Port>");
        let server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        if (server.process == null) return console.log(server.config.label, "is already stopped");
        server.log("Server Stopped by console");
        let resp = server.stop(true);
        if (resp != null) return console.log("Stop failed: " + resp);
    } else if (command == "start") {
        if (args[0] == null) return console.log("Usage: start <Server label|UID|Port>");
        let server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        if (server.process != null) return console.log("Server already active!");
        server.log("Server Started by console");
        let resp;
        try {
            resp = await server.start();
        } catch (e) {
            console.log("Start failed:", e);
            return;
        }
        if (resp != null) return console.log("Start failed: " + resp);
    } else if (command == "restartforce" || command == "rf" || command == "fr") {
        if (args[0] == null) return console.log("Usage: restartforce <Server label|UID|Port>");
        let server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        server.log("Server Forcibly Restarted by console");
        let resp;
        try {
            resp = await server.restart(true);
        } catch (e) {
            console.log("Restart failed:", e);
            return;
        }
        if (resp != null) return console.log("Restart failed: " + resp);
    } else if (command == "restart") {
        if (args[0] == null) return console.log("Usage: restart <Server label|UID|Port>");
        let server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        server.log("Server Restarted by console");
        let resp;
        try {
            resp = await server.restart();
        } catch (e) {
            console.log("Restart failed:", e);
            return;
        }
        if (resp != null) return console.log("Restart failed: " + resp);
    } else if (command == "exec" || command == "run") {
        if (args[0] == null && args[1] == null) return console.log("Usage: exec/run <Server label|UID|Port> <command>");
        let server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        if (server.process == null) return console.log("Server not running!");
        args.shift() //remove the server hint
        args = args.join(" ");
        console.log("Sending command " + chalk.green(args) + " to " + server.config.label);
        server.verbose("Command sent by console: " + args);
        let resp = server.command(args);
        if (resp != null) return console.log("Command failed: " + resp);
    } else if (command == "quit" || command == "exit") {
        quit();
    } else if (command == "startAll" || command == "sa") {
        NVLA.log("Console started all servers");
        NVLA.servers.forEach((server) => server.start().catch(() => {}));
    } else if (command == "stopAll" || command == "sta") {
        NVLA.log("Console stopped all servers");
        NVLA.servers.forEach((server) => server.state.stopping ? server.stop(true, true) : server.stop(true));
    } else if (command == "restartAll" || command == "ra") {
        NVLA.log("Console restarted all servers");
        NVLA.servers.forEach((server) => {
            try {
                if (server.state.restarting == false && server.state.delayedRestart == false) server.restart()
            } catch (e) {
                server.error("Failed restart server: {e}", {e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e});
            }
        });
    } else if (command == "list") {
        console.log(chalk.yellow("Server List:"));
        NVLA.servers.forEach(function(server) {
            let state = chalk.red("INACTIVE");
            if (server.state.updating) state = chalk.red("UPDATING");
            if (server.state.restarting) state = chalk.yellow("RESTARTING");
            if (server.state.stopping) state = chalk.yellow("STOPPING");
            if (server.state.starting) state = chalk.yellow("STARTING");
            if (server.state.running) state = chalk.green("ACTIVE");
            if (server.state.installing) state = chalk.cyan("INSTALLING");
            if (server.state.configuring) state = chalk.cyan("CONFIGURING");
            if (server.state.idleMode) state = chalk.magenta("IDLE");
            if (server.state.error != null) state = chalk.red("ERROR");
            console.log("[" + state + "]\t" + chalk.cyan(server.config.label + " - " + server.config.port + (server.state.players != null ? (" - " + server.state.players.length + " Players") : "") + (server.process != null && server.state.uptime != null ? " - Uptime: " + Math.floor((Date.now() - server.state.uptime) / 1000).toString().toHHMMSS() : "") + (server.state.roundStartTime != null ? " - Round Time: " + (Math.floor((Date.now() - server.state.roundStartTime) / 1000).toString().toHHMMSS()) : "")));
        });
    } else if (command == "version" || command == "v") {
        console.log("Running NVLA - " + pack.version);
    } else if (command == "fullRestart" || command == "fullr") {
        restart();
    } else if (command == "delete" || command == "rm" || command == "del") {
        if (args[0] == null) return console.log("Usage: delete <Server label|UID|Port>");
        let server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        server.log("Console uninstalling server");
        let result
        try {
            result = await server.uninstall();
        } catch (e) {
            server.error("Failed to uninstall server: {e}", {e: e != null ? e.code || e.message : e, stack: e != null ? e.stack : e});
            return;
        }
        if (result != null) {
            server.error("Failed to uninstall server: {e}", {e: result});
            return;
        }
        NVLA.servers.delete(server.config.id);
    } else {
        console.log("Unknown Command: " + chalk.green(command));
    }
}

function cleanInput (args) {
    args = args.trim();
    args = args.split(" ");
    var temp = {};
    for (let i in args) temp[i] = args[i].trim();
    args = [];
    for (let i in temp) if (temp[i] != "") args.push(temp[i]);
    return args
  }

var exiting = false;
function quit () {
  if (exiting) {
    console.log(chalk.yellow("Force quitting.."));
    return process.exit(1);
  }
  stdin.pause();
  exiting = true;
  console.log(chalk.yellow("Process exiting.."));
  NVLA.stop();
  NVLA.on("updateServerState", checkshutdown);
  checkshutdown();
}

function checkshutdown () {
    var allStopped = true;
    NVLA.servers.forEach(function (server) {
        if (server.process != null) allStopped = false;
    });
    if (allStopped) {
        console.log(chalk.green("All servers stopped, exiting"));
        process.exit(0);
    }
}

function restart () {
    if (exiting) return;
    stdin.pause();
    exiting = true;
    console.log(chalk.yellow("Process restarting.."));
    NVLA.stop(true);
    NVLA.on("updateServerState", checkRestart);
    checkRestart();
}

var restarting = false;

function checkRestart () {
    var allStopped = true;
    NVLA.servers.forEach(function (server) {
        if (server.process != null) allStopped = false;
    });
    if (allStopped && !restarting) {
        restarting = true;
        console.log(chalk.green("All servers stopped, restarting"));
        if (NVLA.daemonMode) process.exit(6);
        var replacement = spawn(process.execPath, [__filename, "-child"], {stdio: ['ignore', "ignore", "ignore", 'ipc'], detached: true});
        replacement.on("message", function (m) {
            if (m.type == "ready") {
                this.disconnect();
                this.unref();
                process.exit(0);
            }
        }.bind(replacement));
        replacement.on("error", function (e) {
            console.error(e);
            process.exit(1);
        });
        replacement.on("exit", function (code) {
            console.error("Child exited with code " + code);
            process.exit(code);
        })
    }
}

var stdin = process.openStdin();
stdin.addListener("data", function(d) {
	var test = d.toString();
	try {
		evaluate(test);
	} catch (e) {
		console.log("Failed user input: ", e);
	}
});

process.on('SIGINT', quit);
process.on('SIGQUIT', quit);