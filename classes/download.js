const undici = require("undici");
const fs = require("fs");
const fork = require("child_process").fork;
const path = require("path");

module.exports = class Download {
    /** @type import("./downloader") */
    main;

    started = false;
    
    
    constructor(main, label, server, path, destination, address, port, type) {
        this.main = main;
        this.id = this.main.id;
        this.label = label;
        this.server = server;
        this.path = path;
        this.destination = destination;
        this.address = address;
        this.port = port;
        this.type = type;
        this.main.queue.set(this.id, this);
    }

    start () {
        if (this.started) return;
        this.started = true;
        if (this.type == "file") this.main.main.verbose("Starting download " + this.label + " from " + this.server + " path:" + this.path);
        else this.main.main.verbose("Starting download of " + this.label + ":" + this.path);
        this.process = fork(__filename, {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
        this.process.on("message", this.onMessage.bind(this));
        this.process.on("exit", this.onExit.bind(this));
        this.process.send({type: "init", label: this.label, server: this.server, path: this.path, destination: this.destination, address: this.address, port: this.port, Ftype: this.type, key: this.main.key, machine: this.main.main.main.settings.Vega.id});
    }

    cancel () {
        if (!this.started) return this.main.queue.delete(this.id);
        this.main.main.verbose("Cancelling download " + this.label + " from " + this.server + " path:" + this.path);
        if (this.process != null) {
            this.process.kill();
            this.process = null;
        }
    }

    onExit (code, signal) {
        this.process = null;
        this.main.inProgress.delete(this.id);
        this.main.main.verbose("Download " + this.label + " for " + this.server + " path:" + this.path + " exited with code: " + code + " signal: " + signal);
        if (typeof code == "number" && code != 0) this.main.errors.push(code);
        this.main.processQueue();
    }

    onMessage (message) {
        if (typeof message == "object" && message != null) {
            if (message.type == "error") this.main.main.error("Download error: {error}", this.main.main.main.lp({error: message.error}));
        } else {
            this.main.main.warn("Invalid message received: ", message);
        }
    }
}

class IDownload {
    
    get options () {
        return {method: 'GET', headers: { 'Authorization': this.key, "machine": this.machine }, query: {path: this.type == "file" ? JSON.stringify({path: this.path}) : null}};
    }

    get url () {
        return `http://${this.address}:${this.port}/download/${this.type}/${this.label}/${this.type == "file" ? this.server : this.path}`;
    }
    
    constructor(label, server, path, destination, address, port, type, key, machine) {
        process.on("message", this.onMessage.bind(this));
        this.label = label;
        this.server = server;
        this.path = path;
        this.destination = destination;
        this.address = address;
        this.port = port;
        this.type = type;
        this.key = key;
        this.machine = machine;
        this.download();
    }

    download () {
        let file;
        try {
            fs.mkdirSync(path.dirname(this.destination), {recursive: true});
            file = fs.createWriteStream(this.destination);
        } catch (err) {
            process.send({type: "error", error: "Error creating file: " + err.message});
            process.exit(2);
        }
        file.on('error', (err) => {
            process.send({type: "error", error: "Error writing to file: " + err.message});
            process.exit(3);
        });
        const request = undici.request(this.url, this.options);
        request.then(async response => {
            if (response.statusCode != 200) {
                process.send({type: "error", error: "Error downloading file: " + response.statusCode + " - " + await response.body.text()});
                process.exit(4);
            }
            response.body.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    process.exit(0);
                });
            });
        }).catch(err => {
            process.send({type: "error", error: err.message});
            process.exit(5);
        });
    }
    
    onMessage (message) {
        //Nothing for now
        return message;
    }
}

if (require.main === module) {
    process.on('SIGINT', () => {}); //Prevent the process from closing
    process.on('SIGTERM', () => {}); //Prevent the process from closing
    process.on('SIGUSR1', () => {}); //Prevent the process from closing
    let handle = function (message) {
      if (typeof message == "object" && message != null && message.type == "init") {
        new IDownload(message.label, message.server, message.path, message.destination, message.address, message.port, message.Ftype, message.key, message.machine);
        return;
      } else if (typeof message == "object" && message != null) {
        console.error("Invalid message received: " + JSON.stringify(message));
      } else {
        console.error("Invalid message received: " + message);
      }
      process.once("message", handle);
    }
    process.once("message", handle);
}