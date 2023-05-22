const winston = require("winston");
const { SeqTransport } = require("@datalust/winston-seq");

/** @type {import("./classes")["seqSettings"]["prototype"]} */
let settings;

/** @type import("winston")["Logger"]["prototype"] */
let logger;


process.on("message", onMessage);
function onMessage (m) {
    if (m.type == "config") {
        settings = m.settings;
        let transport = new SeqTransport({
            maxBatchingTime: 50,
            level: "verbose",
            format: winston.format.printf((info) => {
                for (i in info.replacementData) info[i] = info.replacementData[i];
                delete info.replacementData;
                return info.message;
            }),
            serverUrl: "http" + (settings.secure ? "s" : "") + "://" + settings.host,
            apiKey: settings.apiKey,
            onError: (e) => {
                console.error(e);
            },
        });
        let transports = [transport];
        logger = winston.createLogger({
            format: winston.format.combine(
              winston.format.errors({ stack: true }),
              winston.format.json()
            ),
            transports: transports,
        });
        process.send({type: "ready"});
    } else if (m.type == "log" && logger != null) {
        if (m.data.level == "info") logger.info("", {replacementData: m.data});
        else if (m.data.level == "verbose") logger.verbose("", {replacementData: m.data});
        else if (m.data.level == "error") logger.error("", {replacementData: m.data});
    }
}

process.send({type: "started"});