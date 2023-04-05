require('winston-daily-rotate-file');
const winston = require("winston");
const { SeqTransport } = require("@datalust/winston-seq");
const chalk = require("chalk");
const path = require("path");
const util = require("util");

const ansiStripRegexPattern = [ '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)', '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))' ].join('|');
const ansiStripRegex = new RegExp(ansiStripRegexPattern, 'g');

var transports = [
    new winston.transports.Console({
        format: winston.format.printf((info) => {
            processPrintF(info);
            if (info.level == "error") info.message = chalk.red(info.message);
            return info.message;
        })
    }),
    new winston.transports.DailyRotateFile({ frequency: '24h', datePattern: 'YYYY-MM-DD', filename: path.join("./Logs", 'Main-%DATE%.log'), maxsize: "10M", maxFiles: 10, tailable: true, 
        format: winston.format.printf((info) => {
            processPrintF(info);
            info.message = info.message.replace(ansiStripRegex, "");
            return info.message;
        })
    })
];

transports.push(new SeqTransport({format: winston.format.printf((info) => {
    processPrintF(info, true);
    info.message = info.message.replace(ansiStripRegex, "");
    return info.message;
}), serverUrl: "http://192.168.1.121:5341", apiKey: "xiP1sphcjDaQOcjr9WQx", onError: (e) => { console.error(e); }}));

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: transports
});

function processPrintF (info, seq) {
    let data = (info[Symbol.for("splat")] || [])[0] || [];
    let metadata = (info[Symbol.for("splat")] || [])[1] || [];
    //console.log(data);
    if (typeof data == "object" && !seq) for (i in data) if (i != "type") info.message = info.message.replaceAll("{"+i+"}", typeof data[i] != "string" && (data[i].constructor != null ? data[i].constructor.name != "Error" : true) ? util.inspect(data[i], false, 7, false) : data[i].toString());
    if (metadata.color != null && !seq) info.message = colors[metadata.color](info.message);
    if (!seq) info.message = info.message + (info.stack != null ? "\n"+info.stack : "");
    if (!seq) info.message = info.message.replaceAll("\r","").split("\n");
    if (!seq) for (i in info.message) info.message[i] = `[${currTime(true)}] ${(info.type != null ? `[${resolveType(info.type)}] ` : "")}` + info.message[i];
    if (!seq) info.message = info.message.join("\n");
    if (seq && info.type != null) {
        info.type = resolveType(info.type, info);
    }
}

function resolveType (type, info) {
    if (info == null) info = {};
    if (typeof type == "string") {
        if (objectTypes[type] != null) return typeof objectTypes[type] == "function" ? objectTypes[type](type, info) : objectTypes[type];
        else return type;
    } else if (typeof type == "object") {
        //console.log(type.constructor);
        if (type.constructor == null) return "Unknown";
        let res = type.constructor.name;
        if (objectTypes[res] != null) return typeof objectTypes[res] == "function" ? objectTypes[res](type, info) : objectTypes[res];
        else return res;
    } else {
        return resolveType(type.toString(), info);
    }
}

logger.exitOnError = false;

let objectTypes = {
    test: "Formated Test",
    Server: function (server, info) {
        info.serverId = server.id;
        return server.id
    }
}

let number = 0;

class Server {
    id =  "Server-1"
}

function currTime(date) {
    const d = new Date();
    const str = (date ? `${d.getMonth()+1}/${d.getDate()} ` : '') + `${d.toTimeString().slice(0, 8)}.${d.getMilliseconds().toString().padStart(3, '0')}`;
    return str;
}

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

setInterval(function () {
    //logger.info("Hello {name} {number} " + chalk.bold(chalk.red("This is red")), {name: "World", type: "test", number: number});
    number++;
}, 1000);

logger.info("Hello {name} {number} " + chalk.bold(chalk.blue("This is blue")), {name: "World", type: "test", number: {test: "hello", wow: "yes"}});
logger.error("Hello {name} {number} " + chalk.bold(chalk.blue("This is blue")), {name: "World", type: new Server(), number: {test: "hello", wow: "very"}});
logger.info("Hello {name} {number} " + chalk.bold(chalk.blue("This is blue")), {name: "World", type: null, number: {test: "hello", wow: "very"}});
logger.info("Hello", {type: new Server()}, {color: 6});

function test () {
    try {
        require("fs").readFileSync("./test");
    } catch (e) {
        logger.error("Encountered error {e}", {type: this, e: e.code, stack: e.stack});
    }   
}

test();