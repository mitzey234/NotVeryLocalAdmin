const { fork } = require('child_process');
const Stream = require('stream');
const { inspect } = require('util');
const winston = require('winston');
const chalk = require("chalk");
const path = require("path");
const Settings = require('./settings.js');
require("winston-daily-rotate-file");

function currTime(date = Date.now()) {
    const d = new Date();
    const str = (date ? `${d.getMonth() + 1}/${d.getDate()} ` : "") + `${d.toTimeString().slice(0, 8)}.${d.getMilliseconds().toString().padStart(3, "0")}`;
    return str;
}

function shortCurrTime() {
    const d = new Date();
    const str = `${d.toTimeString().slice(0, 8)}.${d.getMilliseconds().toString().padStart(3, "0")}`;
    return str;
}

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

class winstonLoggerSeq {
    /** @type {import("./logging.js")["Logger"]["prototype"]} */
    main;

    /** @type {import('child_process').ChildProcess} */
    process;

    /** @type import("./settings.js")["SeqSettings"]["prototype"] */
    settings;

    stopping = false;

    restarting = false;

    promise;

    /** @type function */
    resolve;

    /** @type function */
    reject;

    timeout;

    errored = false;

    /** @type {import('winston').transports.StreamTransportInstance} */
    transport;

    constructor(main, settings) {
        this.main = main;
        this.settings = settings;
        if (this.settings.enabled) this.promise = this.start();
    }

    async log(args) {
        args.application = "NotVeryLocalAdmin";
        args.identifier = this.main.Main.settings.Vega.id || this.main.Main.settings.Vega.label;
        if (args.type == null) args.type = "log";
        if (this.errored) return;
        try {
            if (
                this.process != null &&
                this.process.exitCode == null &&
                !this.stopping
            )
                this.process.send({ type: "log", data: args });
        } catch (e) {
            this.errored = true;
            return;
        }
    }

    start() {
        if (this.process != null) return;
        console.log("Starting Winston Seq Logger");
        this.process = fork(path.join(__dirname, "winstonLoggerSeq.js"), {stdio: ["ignore", "pipe", "pipe", "ipc"]});
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
            format: winston.format.printf(
                function (info) {
                    if (this.settings.enabled && this.process != null && !this.stopping) this.log(info);
                }.bind(this)
            ),
            stream: this.writableStream,
        });
        return this.promise;
    }

    stop() {
        if (this.process == null) return;
        this.main.log("Stopping Winston Seq Logger", this.main.Main.lp({ consoleColor: 6 }));
        this.stopping = true;
        this.main.winston.remove(this.transport);
        this.transport.destroy();
        this.writableStream.destroy();
        this.process.kill();
    }

    handlePromise(resolve, reject) {
        this.resolve = resolve;
        this.reject = reject;
    }

    async onMessasge(msg) {
        if (msg.type == "started") {
            this.process.send({ type: "config", settings: this.settings.toObject() });
        } else if (msg.type == "ready") {
            this.main.log("Winston Seq Logger ready", this.main.Main.lp({ consoleColor: 2 }));
            if (this.main.winston.transports.find((t) => t == this.transport) == null) this.main.winston.add(this.transport);
            clearTimeout(this.timeout);
            this.timeout = null;
            this.resolve();
            this.resolve = null;
            this.reject = null;
        }
    }

    onError(err) {
        this.errored = true;
        if (this.process.killed) {
            this.process = null;
            try {
                this.main.winston.remove(this.transport);
            } catch (e) {
                this.main.error("Failed removing transport");
            }
        }
        this.main.error("Winston Seq Logger error: {err}", this.main.Main.lp({err: err.code || err.message, stack: err.stack }));
        if (this.reject != null) {
            this.reject("Winston Seq Logger error\n" + err);
            clearTimeout(this.timeout);
            this.timeout = null;
            this.resolve();
            this.resolve = null;
            this.reject = null;
        }
    }

    onExit(code) {
        this.process = null;
        console.log("Winston Seq Logger exited", code);
        try {
            this.main.winston.remove(this.transport);
        } catch (e) {
            this.main.error("Failed removing transport");
        }
        if (this.stopping) {
            this.stopping = false;
            this.main.log("Winston Seq Logger exited with code {code}", this.main.Main.lp({code}));
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
        if (this.restarting) {
            this.restarting = false;
            this.main.log("Winston Seq Logger exited with code {code}, restarting", this.main.Main.lp({code: code, consoleColor: 6}));
            this.start();
            return;
        }
        this.main.error("Winston Seq Logger exited unexpectedly with code {code}", this.main.Main.lp({code: code}));
        this.start();
    }
}

module.exports.Logger = class Logger {
    /** @type {import("./core.js")["Main"]["prototype"]} */
    Main;

    winston = winston.createLogger();

    /** @type {Settings.LogSettings} */
    settings;

    /** @type winstonLoggerSeq */
    seq;

    /** @type {winston.transports.ConsoleTransportInstance} */
    consoleTransport;

    logFileTransport;

    ready = false;

    constructor(main) {
        this.Main = main;
        this.settings = this.Main.settings.log;
        this.consoleTransport = new winston.transports.Console({format: winston.format.printf(this.processOutput.bind(this, false)), level: this.settings.logLevel});
        this.seq = new winstonLoggerSeq(this, this.Main.settings.seq);

        this.winston.add(this.consoleTransport);
        if (this.settings.enabled) {
            this.logFileTransport = this.createRotatedLogTransport();
            this.winston.add(this.logFileTransport);
        }
        this.wait();
    }

    async wait() {
        await this.seq.promise;
        this.ready = true;
    }

    stop () {
        if (this.seq != null) this.seq.stop();
    }

    createRotatedLogTransport () {
        return new winston.transports.DailyRotateFile({
          frequency: "24h",
          datePattern: "YYYY-MM-DD",
          filename: path.join(
            this.settings.logfolder,
            "Main-%DATE%.log"
          ),
          maxsize: this.settings.maxSize,
          maxFiles: this.settings.maxCount,
          tailable: true,
          level: this.settings.logLevel,
          format: winston.format.printf(this.processOutput.bind(this, true)),
        });
    }

    processOutput (colorLess = false, data) {
        let properties = (data[Symbol.for("splat")] || [])[0] || {};
        for (let x in properties) data.message = data.message.replace(new RegExp(`{${x}}`, 'g'), typeof properties[x] == "string" ? properties[x] : inspect(properties[x], {colors: !colorLess , depth: 3}));
        let pre = "";
        if (this.settings.includeTimestamp) {
            let timestamp = currTime();
            if (this.settings.useShortenedTimestamp) timestamp = shortCurrTime();
            if (this.settings.useUptimeInstead) timestamp = process.uptime();
            pre += "["+timestamp+"]" + " ";
        }
        
        if (data.serverName != null) pre += "["+data.serverName+"]" + " ";
        if (this.settings.showLevel) pre += "["+data.level+"]" + " ";
        if (this.settings.showLabels && data.label != null) pre += "["+data.label+"]" + " ";
        if (this.settings.includeFunctionLocation) pre += "["+properties.funcLocation+"]" + " ";
        if (this.settings.includeSource) pre += "["+properties.source+"]" + " ";

        data.message = data.message.split("\n")
        for (let i in data.message) {
            let d = data.message[i];
            if (properties.consoleColor != null && !colorLess) d = colors[properties.consoleColor](d);
            data.message[i] = pre + d;
        }
        data.message = data.message.join("\n");

        if (data.level == "error" && !colorLess) data.message = colors[4](data.message);
        else if (data.level == "warn" && !colorLess) data.message = colors[6](data.message);
        else if ((data.level == "debug" || data.level == "verbose") && !colorLess) data.message = colors[3](data.message);

        return data.message;
    }

    log(...message) {
        this.process("info", ...message);
    }

    error(...message) {
        this.process("error", ...message);
    }

    warn(...message) {
        this.process("warn", ...message);
    }

    debug(...message) {
        this.process("verbose", ...message);
    }

    process(logType = "info", ...message) {
        let properties = {};
        let type = __type;
        let function_name = __function;
        let file = this.settings.fullPaths ? __file : path.relative(process.cwd(), __file);
        let line = __line;
        properties.source = (type != null ? type : "") + (type != null && function_name != null ? "." : "") + (function_name != null ? function_name : "");
        properties.funcLocation = file+":"+line;
        properties.uptime = process.uptime();
        properties.stack = this.settings.attachStacks ? __stringStack : null;
        message = message.filter((item) => {
            if (item instanceof module.exports.LP) {
                for (let i in item.properties) {
                    properties[i] = item.properties[i];
                }
                return false;
            }
            return true;
        });
        for (let i = 0; i < message.length; i++) if (typeof message[i] != "string") message[i] = inspect(message[i], {colors: false, depth: 3});
        this.winston.log(logType, message.join(" "), properties);
    }

    /**
     * @param {{logType: string, message: string, properties: object}} data 
     */
    processCaptureLogger (data) {
        data.properties.funcLocation = this.settings.fullPaths ? data.properties.funcLocationFull : data.properties.funcLocation;
        delete data.properties.funcLocationFull;
        if (!this.settings.attachStacks) delete data.properties.stack;
        this.winston.log(data.logType, data.message, data.properties);
    }
}

class supportedProperties {
    /** @type number */
    consoleColor = null;
}

module.exports.LP = class LogProperties {
    properties = {};
    /**
     * @param  {...supportedProperties} args 
     */
    constructor(...args) {
        for (let i in args) {
            if (args[i] instanceof Object) {
                for (let x in args[i]) {
                    this.properties[x] = args[i][x];
                }
            }
        }
    }
}

let supportedTypes = ["process", "log", "error", "warn", "info", "debug"];

Object.defineProperty(global, '__stack', {
    get: function() {
        var orig = Error.prepareStackTrace;
        Error.prepareStackTrace = function(_, stack) {
            return stack;
        };
        var err = new Error;
        Error.captureStackTrace(err, arguments.callee);
        var stack = err.stack;
        Error.prepareStackTrace = orig;
        return stack;
    }
});

Object.defineProperty(global, '__stringStack', {
    get: function() {
        var orig = Error.prepareStackTrace;
        Error.prepareStackTrace = function(_, stack) {
            return stack;
        };
        var err = new Error;
        Error.captureStackTrace(err, arguments.callee);
        var stack = err.stack;
        Error.prepareStackTrace = orig;

        let str = "";
        let i;
        for (i = 1; i < stack.length; i++) if (!supportedTypes.includes(stack[i].getFunctionName())) break;
        for (let x = i; x < stack.length; x++) {
            str += stack[x].toString() + "\n";
        }
        return str.trim();
    }
});
    
Object.defineProperty(global, '__line', {
    get: function() {
        let stack = __stack;
        let i;
        for (i = 1; i < stack.length; i++) if (!supportedTypes.includes(stack[i].getFunctionName())) break;
        return stack[i].getLineNumber() + ":" + stack[i].getColumnNumber();
    }
});

Object.defineProperty(global, '__function', {
    get: function() {
        let stack = __stack;
        let i;
        for (i = 1; i < stack.length; i++) if (!supportedTypes.includes(stack[i].getFunctionName())) break;
        return stack[i].getFunctionName();
    }
});

Object.defineProperty(global, '__file', {
    get: function() {
        let stack = __stack;
        let i;
        for (i = 1; i < __stack.length; i++) if (!supportedTypes.includes(stack[i].getFunctionName())) break;
        return stack[i].getFileName();
    }
});

Object.defineProperty(global, '__type', {
    get: function() {
        let stack = __stack;
        let i;
        for (i = 1; i < stack.length; i++) if (!supportedTypes.includes(stack[i].getFunctionName())) break;
        return stack[i].getTypeName();
    }
});