const { EventEmitter } = require("steam-user");
const Download = require("./download");

module.exports = class Downloader extends EventEmitter {
    /** @type import("./server") */
    main;

    /** @type Map<string, Download> */
    queue = new Map();

    /** @type Map<string, Download> */
    inProgress = new Map();

    promises = [];

    errors = [];

    get key () {
        return this.main.main.vega.apiKey;
    }

    get id () {
        let id = Math.random().toString(36).substring(2, 15);
        while (this.queue.has(id) || this.inProgress.has(id)) {
            id = Math.random().toString(36).substring(2, 15);
        }
        return id;
    }

    get count () {
        return this.queue.size + this.inProgress.size;
    }

    constructor(main) {
        super();
        this.main = main;
        
    }

    hook () {
        if (this.queue.size == 0 && this.inProgress.size == 0) return;
        let obj = {};
        this.promises.push(obj);
        return new Promise((resolve, reject) => {
            obj.resolve = resolve;
            obj.reject = reject;
        });
    }

    complete() {
        this.main.log("All downloads complete", this.main.main.lp({consoleColor: 2}));
        if (this.errors.length > 0) {
            this.promises.forEach((obj) => obj.reject(new Error(this.errors.join(","))));
            this.promises = [];
            this.errors = [];
        } else {
            this.promises.forEach((obj) => obj.resolve());
            this.promises = [];
        }
    }

    processQueue () {
        this.emit("progress", this.count);
        if (!this.main.main.vega.connected || this.key == null) return;
        if (this.inProgress.size == 0 && this.queue.size == 0) return this.complete();
        if (this.queue.size == 0 || this.inProgress.size >= this.main.main.settings.maxConcurrentDownloads) return;
        let download = this.queue.values().next().value;
        this.queue.delete(download.id);
        this.inProgress.set(download.id, download);
        download.start();
        this.processQueue();
    }

    downloadFile(label, server, path, destination) {
        if (this.key == null || this.main.main.vega.connected == false) {
            this.main.error("Vega not connected, cannot download file", this.main.main.lp({consoleColor: 4}))
            return -1;
        }
        new Download(this, label, server, path, destination, this.main.main.settings.Vega.host, this.main.main.vega.port, "file");
        this.processQueue();
    }

    downloadAssembly(label, assembly, destination) {
        if (this.key == null || this.main.main.vega.connected == false) {
            this.main.error("Vega not connected, cannot download assembly", this.main.main.lp({consoleColor: 4}))
            return -1;
        }
        new Download(this, label, null, assembly, destination, this.main.main.settings.Vega.host, this.main.main.vega.port, "assembly");
        this.processQueue();
    }

    cancelAll () {
        this.queue.forEach((download) => download.cancel());
        this.inProgress.forEach((download) => download.cancel());
        this.promises.forEach((obj) => obj.reject(new Error("Download cancelled")));
        this.promises = [];
    }
}