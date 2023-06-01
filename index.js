const classes = require("./classes");
const chalk = require("chalk");
const fs = require("fs");
const pack = require("./package.json");

let NVLA = new classes.NVLA;
NVLA.start();

process.on('uncaughtException', function(err) {
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
    if (NVLA.ServerManager.servers.has(hint)) {
        return NVLA.ServerManager.servers.get(hint);
    } else {
        let server;
        NVLA.ServerManager.servers.forEach((s) => {
            if (s.config.label == hint || s.config.label.indexOf(hint) > -1) server = s;
        });
        if (server != null) return server;
        NVLA.ServerManager.servers.forEach((s) => {
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
        var resp = server.stop(true);
        if (resp != null) return console.log("Stop failed: " + resp);
    } else if (command == "start") {
        if (args[0] == null) return console.log("Usage: start <Server label|UID|Port>");
        var server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        if (server.process != null) return console.log("Server already active!");
        server.log("Server Started by console");
        var resp = await server.start();
        if (resp != null) return console.log("Start failed: " + resp);
    } else if (command == "restartforce" || command == "rf" || command == "fr") {
        if (args[0] == null) return console.log("Usage: restartforce <Server label|UID|Port>");
        var server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        server.log("Server Forcibly Restarted by console");
        var resp = server.restart(true);
        if (resp != null) return console.log("Restart failed: " + resp);
    } else if (command == "restart") {
        if (args[0] == null) return console.log("Usage: restart <Server label|UID|Port>");
        var server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        server.log("Server Restarted by console");
        var resp = await server.restart();
        if (resp != null) return console.log("Restart failed: " + resp);
    } else if (command == "exec" || command == "run") {
        if (args[0] == null && args[1] == null) return console.log("Usage: exec/run <Server label|UID|Port> <command>");
        var server = getServer(args[0]);
        if (server == null) return console.log("Server not found");
        if (server.process == null) return console.log("Server not running!");
        args.shift() //remove the server hint
        args = args.join(" ");
        console.log("Sending command " + chalk.green(args) + " to " + server.config.label);
        server.verbose("Command sent by console: " + args);
        var resp = server.command(args);
        if (resp != null) return console.log("Command failed: " + resp);
    } else if (command == "quit" || command == "exit") {
        quit();
    } else if (command == "startAll" || command == "sa") {
        NVLA.log("Console started all servers");
        NVLA.ServerManager.servers.forEach((server) => server.start());
    } else if (command == "stopAll" || command == "sta") {
        NVLA.log("Console stopped all servers");
        NVLA.ServerManager.servers.forEach((server) => server.state.stopping ? server.stop(true, true) : server.stop(true));
    } else if (command == "restartAll" || command == "ra") {
        NVLA.log("Console restarted all servers");
        NVLA.ServerManager.servers.forEach((server) => server.restart());
    } else if (command == "list") {
        console.log(chalk.yellow("Server List:"));
        NVLA.ServerManager.servers.forEach(function(server) {
            let state = chalk.red("INACTIVE");
            if (server.state.updating) state = chalk.red("UPDATING");
            if (server.state.restarting) state = chalk.yellow("RESTARTING");
            if (server.state.stopping) state = chalk.yellow("STOPPING");
            if (server.state.starting) state = chalk.yellow("STARTING");
            if (server.state.running) state = chalk.green("ACTIVE");
            if (server.state.installing) state = chalk.cyan("INSTALLING");
            if (server.state.configuring) state = chalk.cyan("CONFIGURING");
            if (server.state.idleMode) state = chalk.magenta("IDLE");
            if (server.errorState != null) state = chalk.red("ERROR");
            console.log("[" + state + "]\t" + chalk.cyan(server.config.label + " - " + server.config.port + (server.players != null ? (" - " + server.players.length + " Players") : "") + (server.process != null && server.uptime != null ? " - Uptime: " + Math.floor((Date.now() - server.uptime) / 1000).toString().toHHMMSS() : "") + (server.roundStartTime != null ? " - Round Time: " + (Math.floor((Date.now() - server.roundStartTime) / 1000).toString().toHHMMSS()) : "")));
        });
    } else if (command == "version" || command == "v") {
        console.log("Running NVLA - " + pack.version);
    } else if (command == "fullRestart" || command == "fullr") {
        return;
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
        return;
        console.log("Forcing full restart of program..");
        fullRestart();
    } else {
        console.log("Unknown Command: " + chalk.green(command));
    }
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

var exiting = false;
function quit () {
  if (exiting) return;
  stdin.pause();
  exiting = true;
  console.log(chalk.yellow("Process exiting.."));
  NVLA.stop();
  NVLA.on("serverStateChange", checkshutdown);
  checkshutdown();
}

function checkshutdown () {
    var allStopped = true;
    NVLA.ServerManager.servers.forEach(function (server) {
        if (server.process != null) allStopped = false;
    });
    if (allStopped) {
        console.log(chalk.green("All servers stopped, exiting"));
        process.exit(0);
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