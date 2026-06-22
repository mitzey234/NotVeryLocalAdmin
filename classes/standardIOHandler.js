const Net = require("net");
const chalk = require("chalk");
const LP = require("./logging").LP;
const ServerConsoleLog = require("./messages/templates/serverConsoleLog");

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

const ansiStripRegexPattern = [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
].join("|");
const ansiStripRegex = new RegExp(ansiStripRegexPattern, "g");

class StandardIOHandler {

    /** @type Net.Server */
    _socket;

    /** @type import("./server") */
    server;

    /** @type Net.Socket */
    connectionToServer;

    buffer;

    /**
     * @param {import("./server")} s 
     */
    constructor(s) {
        this.server = s;
        this.verbose = this.server.verbose.bind(this.server);
        this.log = this.server.log.bind(this.server);
        this.error = this.server.error.bind(this.server);
        this.warn = this.server.warn.bind(this.server);
    }

    async handleStdout(data) {
        let d = data.toString().split("\n");
        for (let i in d) {
            if (d[i].trim() == "") continue;
            if (d[i].indexOf("////NVLAMONITORSTATS--->") > -1) {
                let data = d[i].replace("////NVLAMONITORSTATS--->", "");
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    this.error("Failed to parse NVLA Monitor stats: {e}", new LP({ e: e }));
                    return;
                }
                this.server.monitor.onMonitorUpdate(data);
                return;
            }
            if (d[i].trim() != "") {
                var cleanup = false;
                if (this.server.config.cleanLogs) {
                    if (d[i].indexOf("The referenced script") > -1 && d[i].indexOf("on this Behaviour") > -1 && d[i].indexOf("is missing!") > -1) cleanup = true;
                    else if (d[i].indexOf("Filename:  Line: ") > -1) cleanup = true;
                    else if (d[i].indexOf("A scripted object") > -1 && d[i].indexOf("has a different serialization layout when loading.") > -1) cleanup = true;
                    else if (d[i].indexOf("Did you #ifdef UNITY_EDITOR a section of your serialized properties in any of your scripts?") > -1) cleanup = true;
                    else if (d[i].indexOf("Action name") > -1 && d[i].indexOf("is not defined") > -1) cleanup = true;
                    else if (d[i].indexOf("ERROR: Shader") > -1 || d[i].indexOf("WARNING: Shader") > -1) cleanup = true;
                    else if (d[i].indexOf("There is no texture data available to upload") > -1) cleanup = true;
                    else if (d[i].indexOf("Fallback handler could not load library") > -1) cleanup = true;
                    else if (d[i].indexOf("No mesh data available for mesh") > -1) cleanup = true;
                    else if (d[i].indexOf("Couldn't create a Convex Mesh from source mesh") > -1) cleanup = true;
                    else if (d[i].indexOf("Unknown managed type referenced") > -1) cleanup = true;
                    else if (d[i].indexOf("If subshaders removal was intentional") > -1) cleanup = true;
                    else if (d[i].indexOf("shader is not supported on this GPU") > -1) cleanup = true;
                    else if (d[i].indexOf("Trying to access a shader but no shaders were included") > -1) cleanup = true;
                    else if (d[i].indexOf("does not support negative scale or size") > -1) cleanup = true;
                    else if (d[i].indexOf("effective box size has been forced positive") > -1) cleanup = true;
                    else if (d[i].indexOf("If you absolutely need to use negative scaling") > -1) cleanup = true;
                    else if (d[i].indexOf("Missing **FALLBACK** translation!") > -1) cleanup = true;
                }
                if (cleanup == true && this.server.config.cleanLogs) continue;
                this.verbose(d[i], new LP({ logType: "sdtout", cleanup: cleanup, color: 8 }));
            }
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
                    this.error("Failed to parse NVLA Monitor stats: {e}", new LP({ e: e }));
                    return;
                }
                this.server.monitor.onMonitorUpdate(data);
                return;
            }
            this.error(d[i], new LP({ logType: "sdtout", cleanup: false, color: 8 }));
        }
    }

    destroy() {
        try {
            this._socket.close();
        } catch { }
        this._socket = null;
    }

    handleServerEvent(code) {
        if (code == 16) {
            //RoundRestartedEntry
            if (this.server.state.starting) {
                clearTimeout(this.server.timeout);
                this.server.timeout = null;
                this.log("Started Successfully");
                this.server.restartCount = 0;
                this.server.state.starting = false;
                this.server.state.running = true;
                this.server.state.uptime = Date.now();
                this.server.OnUpdate();
                this.server.hooks.resolve("start");
                this.server.main.balancer.rebalanceServers();
            }
            if (this.server.main.settings.clearLALogs) this.server.clearLALogs();
            this.server.state.roundStartTime = null;
            this.server.restartedRecently = true;
            if (this.server.restartedRecentlyTimeout != null) {
                clearTimeout(this.server.restartedRecentlyTimeout);
                this.server.restartedRecentlyTimeout = null;
            }
            this.server.restartedRecentlyTimeout = setTimeout(() => {
                this.server.restartedRecently = false;
                this.server.restartedRecentlyTimeout = null;
            }, 15000);
        } else if (code == 21 || code == 20) {
            //ExitActionShutdownEntry or ExitActionSilentShutdownEntry
            if (this.server.state.delayedRestart) this.server.state.delayedRestart = false;
            if (this.server.state.stopping && this.server.state.delayedStop) {
                this.server.state.delayedStop = false;
            } else if (this.server.state.stopping && !this.server.state.delayedStop) {
                this.server.state.delayedStop = false;
            } else {
                this.server.state.stopping = true;
                this.server.state.delayedStop = true;
                if (this.server.timeout) {
                    clearTimeout(this.server.timeout);
                    this.server.timeout = null;
                    this.server.hooks.resolve("shutdown", 1); //Restarting delayed
                }
            }
        } else if (code == 22) {
            //ExitActionRestartEntry
            if (this.server.state.delayedStop) this.server.state.delayedStop = false;
            if (this.server.state.restarting && this.server.state.delayedRestart) {
                this.server.state.delayedRestart = false;
            } else if (this.server.state.restarting && !this.server.state.delayedRestart) {
                this.server.state.delayedRestart = false;
            } else {
                this.server.state.restarting = true;
                this.server.state.delayedRestart = true;
                if (this.server.timeout) {
                    clearTimeout(this.server.timeout);
                    this.server.timeout = null;
                    this.server.hooks.resolve("restart", 1); //Restarting delayed
                }
            }
        } else if (code == 19) {
            //ExitActionResetEntry
            if (this.server.state.delayedRestart) {
                this.server.state.delayedRestart = false;
                this.server.state.restarting = false;
            } else if (this.server.state.delayedStop) {
                this.server.state.stopping = false;
                this.server.state.delayedStop = false;
            }
        } else if (code == 17) {
            //Entering idle mode
            this.server.state.idleMode = true;
            this.server.state.players = 0;
            this.server.state.tps = 0;
            if (this.server.monitor.nvlaMonitorInstalled) {
                clearTimeout(this.server.monitor.monitorTimeout);
                this.server.monitor.monitorTimeout = setTimeout(this.server.monitor.monitorUpdateTimeout.bind(this.server.monitor), 60000 * 5);
            }
        } else if (code == 18) {
            //Exiting idle mode
            this.server.state.idleMode = false;
            if (this.server.monitor.nvlaMonitorInstalled) {
                clearTimeout(this.server.monitor.monitorTimeout);
                this.server.monitor.monitorTimeout = setTimeout(this.server.monitor.monitorUpdateTimeout.bind(this.server.monitor), 8000);
            }
        } else if (code == 23) {
            //HeartbeatEntry
            this.log("Heartbeat Entry", new LP({ logType: "heartbeat", color: 6 }));
        }
    }

    handleServerMessage(chunk) {
        if (this.buffer != null) {
            chunk = Buffer.concat([this.buffer, chunk]);
            this.buffer = null;
        }
        // eslint-disable-next-line no-unused-vars
        let data = [...chunk]
        while (chunk.length > 0) {
            let control = chunk.readUInt8(0);
            if (control >= 16) {
                // handle control code
                if (events[control.toString()] != null) this.log("Event Fired: {codename}", new LP({ codename: events[control.toString()], code: control, color: 6 }));
                this.handleServerEvent(control);
                chunk = chunk.slice(1);
                continue;
            }
            if (chunk.length < 5) {
                this.buffer = chunk;
                return;
            }
            let length = chunk.readUInt32LE(1);
            if (chunk.length < 5 + length) {
                this.buffer = chunk;
                return;
            }
            let m = chunk.slice(5, 5 + length);
            chunk = chunk.slice(5 + length);
            let message = "";
            for (let i = 0; i < m.length; i++) message += String.fromCharCode(m[i]);
            if (message.trim() == ("New round has been started.")) {
                this.server.state.roundStartTime = new Date().getTime();
                console.log("Round start:", this.server.state.roundStartTime);
            }
            if (this.server.monitor.checkCallback != null && message.indexOf("List of players") > -1) {
                var players = message.substring(message.indexOf("List of players") + 17, message.indexOf("List of players") + 17 + message.substring(message.indexOf("List of players") + 17).indexOf(")"));
                players = parseInt(players);
                if (isNaN(players)) players = -1;
                this.server.state.players = players;
                this.server.tps = -1;
                this.server.monitor.checkTimeoutCount = 0;
                clearTimeout(this.server.monitor.checkTimeout);
                this.server.monitor.checkTimeout = null;
                this.tempListOfPlayersCatcher = true;
                this.server.monitor.checkCallback();
                return;
            }
            if (this.tempListOfPlayersCatcher) message = message.replaceAll("\n*\n", "*");
            if (this.tempListOfPlayersCatcher && message.indexOf(":") > -1 && (message.indexOf("@") > -1 || message.indexOf("(no User ID)")) && message.indexOf("[") > -1 && message.indexOf("]") > -1 && (message.indexOf("steam") > -1 || message.indexOf("discord") > -1 || message.indexOf("(no User ID)") > -1)) return;
            else if (this.tempListOfPlayersCatcher) delete this.tempListOfPlayersCatcher;
            if (message.charAt(0) == "\n") message = message.substring(1, message.length);
            if (message.indexOf("Welcome to") > -1 && message.length > 1000) message = colors[control]("Welcome to EXILED (ASCII Cleaned to save your logs)");
            if (this.server.main.vega.connected) this.server.main.vega.send(new ServerConsoleLog(this.server.main.vega, this.server.id, message.replace(ansiStripRegex, "").trim(), control, Date.now()));
            this.log(message.trim(), new LP({ logType: "console", color: control }));
        }
    }

    handleServerConnection(connection) {
        if (connection.remoteAddress != "127.0.0.1" && connection.remoteAddress != "::ffff:127.0.0.1") {
            try {
                connection.end();
            } catch (e) { }
            return;
        }
        if (this.connectionToServer != null) {
            try { connection.end() } catch { }
            return;
        }
        this.log("Console Socket Connected");
        this.connectionToServer = connection;
        connection.on("data", this.handleServerMessage.bind(this));
        connection.on('end', this.onSocketEnd.bind(this));
        connection.on('error', this.onSocketErr.bind(this));
    }

    onSocketEnd() {
        this.log("Console Socket Disconnected", new LP({ color: 4 }));
        this._socket = null;
        this.connectionToServer = null;
    }

    onSocketErr(e) {
        try {
            this.socket.end();
        } catch (e) { }
        this.verbose("Console Socket Error: {e}", new LP({ e: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e, color: 4 }));
        this._socket = null;
        this.connectionToServer = null;
    }

    get socket() {
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
            server.on("error", (e) => this.onSocketErr(e) & reject(e));
            server.on("connection", this.handleServerConnection.bind(this));
            server.listen(0, function (s, resolve) { resolve(s); }.bind(this, server, resolve));
            setTimeout(function (reject) { reject("Socket took too long to open"); }.bind(null, reject), 1000);
        }.bind(this));
    }
}

module.exports = StandardIOHandler;