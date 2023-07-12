const Axios = require("axios");
const fs = require("fs");

/** @type downloadSettings */
let settings;

class downloadSettings {
    /* @type {string} */
    url;

    /* @type {string} */
    name;

    /* @type {string} */
    password;

    /* @type {string} */
    path;

    /* @type {string} */
    type;

    /* @type {string} */
    subtype;

    /* @type {string} */
    id;

    /* @type {string} */
    outputPath;
}

process.on("message", onMessage);
async function onMessage (m) {
    if (m.mtype == "config") {
        settings = m;
        try {
            await start();
        } catch (e) {
            process.send({"type": "error", "message": e.message, "code": e.code, "stack": e.stack, "response": e.response != null && e.response.status ? e.response.status : null});
            process.exit(e.response != null && e.response.status ? e.response.status : 1);
        }
        process.exit(0);
    }
}

function start() {

    return Axios({
        method: 'get',
        url: settings.url,
        params: {
            name: settings.name,
            password: settings.password,
            filepath: settings.path,
            type: settings.type,
            subtype: settings.subtype,
            server: settings.id
        },
        timeout: 10000,
        responseType: 'stream',
    }).then(response => {
        return new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(settings.outputPath);
            response.data.pipe(writer);
            let error = null;
            writer.on('error', err => {
                error = err;
                writer.close();
                reject(err);
            });
            writer.on('close', () => {
                if (!error) resolve(true);
            });
        });
    }).catch(e => {
        console.error("Soemthing went wrong with the requset:", e);
    });
}

process.send({type: "ready"});