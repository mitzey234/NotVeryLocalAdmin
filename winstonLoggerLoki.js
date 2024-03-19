const winston = require("winston");
const LokiTransport = require("winston-loki");
const Util = require("util");

/** @type {import("./classes")["lokiSettings"]["prototype"]} */
let settings;

/** @type import("winston")["Logger"]["prototype"] */
let logger;

process.on("message", onMessage);
function onMessage (m) {
    if (m.type == "config") {
        settings = m.settings;
        let transport = new LokiTransport({
            host: "http" + (settings.secure ? "s" : "") + "://" + settings.host,
            batching: settings.batching,
            interval: settings.batchInterval,
            timeout: settings.timeout,
            labels: {job: "NVLA"},
            basicAuth: settings.basicAuth,
            onConnectionError: (e) => console.error("Loki Transmit Error: " + e.code)
        });
        let transports = [transport];
        logger = winston.createLogger({
            format: winston.format.combine(
              winston.format.errors({ stack: true })
            ),
            transports: transports,
        });
        process.send({type: "ready"});
    } else if (m.type == "log" && logger != null) {
      try {
        let message = m.data.message;
        delete m.data.message;
        let labels = {};
        if (m.data.level == "verbose") m.data.level = "debug";
        for (let i in m.data) {
          if (i != "message") message = message.replaceAll("{" + i + "}", m.data[i]);
          if (m.data[i] != null && typeof m.data[i] == "string" && allowedLabels.includes(i) && m.data[i].indexOf("\n") == -1 && m.data[i].indexOf("\r") == -1) {
            labels[i] = m.data[i];
            delete m.data[i];
          }
        }
        m.data.message = message;
        if (m.data.level == "info") logger.info({message: JSON.stringify(m.data), labels: labels});
        else if (m.data.level == "debug") logger.info({message: JSON.stringify(m.data), labels: labels});
        else if (m.data.level == "error") logger.error({message: JSON.stringify(m.data), labels: labels});
      } catch (e) { 
        console.error("Loki Error:", e);
      }
    }
}

let allowedLabels = ["type", "machineId", "serverId", "level"];

process.send({type: "started"});