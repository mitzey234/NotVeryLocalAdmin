const settings = require("./settings");
const EventEmitter = require('events');
const File = require("./manifest").File;
const Worker = require("./decompressor");
const Util = require("./Util");
const Chunk = require("./manifest").Chunk;
const { fork } = require('child_process');
const EDepotFileFlag = require('steam-user/enums/EDepotFileFlag.js');
const Path = require("path");
const ContentServer = require("./contentServer");
const { Client } = require('undici');
const { Writable } = require('stream');
const FS = require("fs");

/** @type settings */
let config;
/** @type FileDownloader */
let main;

class ExtendedContentServer extends ContentServer {
    /** @type Client */
    dispatcher;

    constructor(obj) {
        super(obj);
        let urlBase = (this.https_support == 'mandatory' ? 'https://' : 'http://') + this.Host;
		this.dispatcher = new Client(urlBase);
    }
}

class FileDownloader extends EventEmitter {
    stopping = false;

    /** @type File */
    _file;

    get file () {
        return this._file;
    }

    set file (v) {
        if (this._file === v) return;
        this._file = v;
        if (this.process != null) this.process.send({file: v});
        else console.warn("Tried to send a message to non existing child process!");
    }

    /** @type Buffer */
    _keys;

    get keys () {
        return this._keys;
    }

    set keys (v) {
        if (this._keys === v) return;
        this._keys = v;
        if (this.process != null) this.process.send({keys: v});
        else console.warn("Tried to send a message to non existing child process!");
    }

    /** @type number */
    _appId;

    get appId () {
        return this._appId;
    }

    set appId (v) {
        if (this._appId === v) return;
        this._appId = v;
        if (this.process != null) this.process.send({appId: v});
        else console.warn("Tried to send a message to non existing child process!");
    }

    /** @type string */
    _depotId;

    get depotId () {
        return this._depotId;
    }

    set depotId (v) {
        if (this._depotId === v) return;
        this._depotId = v;
        if (this.process != null) this.process.send({depotId: v});
        else console.warn("Tried to send a message to non existing child process!");
    }

    /** @type Array<ContentServer> */
    _servers;

    get servers () {
        return this._servers;
    }

    set servers (v) {
        if (this._servers === v) return;
        this._servers = v;
        if (this.process != null) this.process.send({servers: v});
        else console.warn("Tried to send a message to non existing child process!");
    }

    _targetPath;
    /** @type string */
    get targetPath () {
        return this._targetPath;
    }

    set targetPath (v) {
        if (this._targetPath === v) return;
        this._targetPath = v;
        if (this.process != null) this.process.send({targetPath: v});
        else console.warn("Tried to send a message to non existing child process!");
    }

    constructor (config) {
        super();
        this.config = config;
        this.init();
    }
    
    init () {
        if (this.process != null) this.stop();
        this.stopping = false;
        this.process = fork(__filename);
        this.process.on("exit", this.onExit.bind(this));
        this.process.on("message", this.onMessage.bind(this));
        try {
            this.process.send(this.config);
        } catch (e) {
            //console.error("Failed sending file worker config:", e);
            return;
        }
        //TODO: restart existing download
    }

    reset () {
        this.file = null;
        this.keys = null;
        this.appId = null;
        this.depotId = null
    }

    stop () {
        this.reset();
        if (this.process == null) return;
        this.stopping = true;
        this.process.kill();
    }

    onExit () {
        this.process = null;
        if (!this.stopping) this.init();
    }

    /** @type {{resolve: Function, reject: Function}} */
    promise;

    hook () {
        let temp = new Promise((r, rej) => this.promise = {resolve: r, reject: rej});
        this.process.send({start: true}); //Start the download
        return temp;
    }

    onMessage (m) {
        if (m.type == "reset") {
            this.reset();
        } else if (m.type == "failure") {
            this.promise.reject(new Error(m.error));
            this.promise = null; //Reset the promise
        } else if (m.type == "complete") {
            //console.log("Done:", this.file.filename);
            this.reset();
            this.promise.resolve(true);
            this.promise = null;
            this.emit("finish", true);
        }
    }
}

class IFileDownloader {
    /** @type settings */
    config;

    /** @type File */
    file;

    /** @type Buffer */
    keys;

    /** @type number */
    appId;

    /** @type string */
    depotId;

    /** @type Array<ExtendedContentServer> */
    _servers;

    /** @type Array<Worker> */
    workers = [];

    workerHooks = [];

    get servers () {
        return this._servers;
    }

    set servers (v) {
        let servers = [];
        for (let i in v) servers.push(new ExtendedContentServer(v[i]));
        this._servers = servers;
    }

    get availableWorker () {
        for (let i in this.workers) if (this.workers[i].process != null && this.workers[i].data == null) return this.workers[i];
        return null;
    }

    /** @type string */
    targetPath;

    fd;

    constructor (config) {
        this.config = config;
        for (let i = 0; i < this.config.decodeWorkers; i++) {
            let worker = new Worker(this.config);
            worker.on("finish", this.onChunkComplete.bind(this, worker)); // Handle file completion
            worker.on("error", this.onError.bind(this)); // Handle worker errors
            this.workers.push(worker); // Initialize file workers
        }
    }

    workerHook () {
        let promise = new Promise((r) => this.workerHooks.push(r));
        return promise;
    }

    onError (e) {
        //console.error("Something went wrong creating the file: " + this.file.filename, e);
        this.reset();
        return process.send({type: "failure", error: e.message || e.code});
    }

    onChunkComplete (worker) {
        if (this.workerHooks.length == 0) return; //No files are waiting
        worker.data = Buffer.alloc(1);
        let hook = this.workerHooks.shift(); //Get the next waiting file
        hook(worker); // Resolve the hook
    }

    async onMessage (m) { 
        if (m.keys != null) {
            this.keys = Buffer.from(m.keys.data);
        }
        if (m.file != null) {
            this.file = m.file;
        }
        if (m.appId != null) {
            this.appId = m.appId;
        }
        if (m.depotId != null) {
            this.depotId = m.depotId;
        }
        if (m.servers != null) {
            this.servers = m.servers;
        }
        if (m.targetPath != null) {
            this.targetPath = m.targetPath;
        }
        if (m.start == true) {
            this.start();
        }
    }

    reset () {
        if (this.fd != null) {
            try {
                FS.closeSync(this.fd);
            } catch {/** Ignore */}
            this.fd = null;
        }
        process.send({type: "reset"});
    }

    /**
     * @param {Buffer} data 
     * @param {string} depot_id 
     * @param {Chunk} chunk 
     * @returns 
     */
    async processChunk (data, depot_id, chunk) {
        //console.log("Start processChunk", this.workerHooks.length, chunk.sha);
        let worker = this.availableWorker;
        if (worker == null) worker = await this.workerHook();
        //console.log("Process chunk", chunk.sha);
        return worker.hook(chunk.sha, data, this.keys);
	}

    concurrent = 0;

    waits = [];

    async wait () {
        let promise = new Promise((r) => this.waits.push(r));
        return promise;
    }

    /**
     * @param {Chunk} chunk 
     * @param {string} depot_id
     * @param {number} fd
     */
    async downloadChunk (chunk, depot_id, fd) {
        //console.log("Start", this.concurrent, chunk.sha);
        while (this.concurrent >= this.config.concurrentDownloads) await this.wait();
        this.concurrent++;
        //console.log("Downloading", chunk.sha);
        let server = this.servers[Math.floor(Math.random() * this.servers.length)];
        var data = [];
        let options = {
			origin: server.urlBase,
			path: `/depot/${depot_id}/chunk/${chunk.sha}`,
			method: 'GET',
			headers: {
				'Host': server.vhost || server.Host,
				'User-Agent': 'DepotDownloader/2.7.3',
			},
			opaque: { data }
		};
        await server.dispatcher.stream(options, ({ statusCode, opaque: { data } }) => {
			if (statusCode != 200) {
				//console.error("Download status error:", statusCode);
				throw new Error("Download status error:", statusCode);
			}
			return new Writable({
				write (chunk, encoding, callback) {
					data.push(chunk)
					callback()
				}
			})
		});
        data = Buffer.concat(data);
		let result = await this.processChunk(data, depot_id, chunk);
		if (Util.getHash(result) != chunk.sha) {
            //console.log("Checksum failure", Util.getHash(result), result.length, chunk.sha);
            throw new Error('Checksum mismatch');
		} else {
			FS.writeSync(fd, result, 0, result.length, parseInt(chunk.offset));
            //console.log("Done:", chunk.sha);
            return true;
		}
    }

    chunkComplete (chunk) {
        this.concurrent--;
        if (this.waits.length > 0) this.waits.shift()();
        this.test.find(e => e.sha == chunk.sha).done = true; // Mark the chunk as done
        //console.log("End:", this.waits.length, this.concurrent, this.test.filter(r => !r.done).length, chunk.sha);
    }


    test = [];

    async start () {
        if (this.keys == null || this.appId == null || this.depotId == null || this.servers == null || this.file == null || this.targetPath == null) {
            //console.error("Child tried to start without required values", this.keys, this.appId, this.depotId, this.servers, this.file, this.targetPath);
            this.reset();
            return process.send({type: "failure", error: "Missing required values"});
        }
        let fullpath = Path.join(this.targetPath, this.file.filename.replaceAll("\\", "/"));
		if (FS.existsSync(Path.parse(fullpath).dir) == false) FS.mkdirSync(Path.parse(fullpath).dir, {recursive: true});

        if (this.fd != null) FS.closeSync(this.fd);

        let mode;
        if ((this.file.flags & EDepotFileFlag.Executable) || (this.file.flags & EDepotFileFlag.CustomExecutable)) mode = 0o777;
        else mode = 0o666;

        try {
            this.fd = FS.openSync(fullpath, 'w', mode);
            FS.ftruncateSync(this.fd, parseInt(this.file.size));
        } catch (e) {
            //console.error("Something went wrong creating the file: " + this.file.filename, e);
            this.reset();
            return process.send({type: "failure", error: e.message || e.code});
        }

        for (let i in this.file.chunks) this.test[i] = {sha: this.file.chunks[i].sha, done: false};

        let proms = [];
        let notDone = true;
        while (notDone) {
            if (proms.length > 0) {
                for (let i in proms) {
                    let chunk = this.file.chunks[i];
                    if (proms[i] != true) {
                        proms[i] = this.downloadChunk(chunk, this.depotId, this.fd).catch(e => e).finally(this.chunkComplete.bind(this, chunk));
                    }
                }
            } else this.file.chunks.forEach((chunk) => proms.push(this.downloadChunk(chunk, this.depotId, this.fd).catch(e => e).finally(this.chunkComplete.bind(this, chunk))));
            proms = await Promise.all(proms);
            if (!proms.some(e => e != true)) notDone = false;
            //console.log("Checking", notDone);
        }
        FS.closeSync(this.fd);
        this.fd = null;
        process.send({type: "complete"});
    }
}

if (require.main === module) {
    process.on('SIGINT', () => {}); //Prevent the process from closing
    process.on('SIGTERM', () => {}); //Prevent the process from closing
    process.on('SIGUSR1', () => {}); //Prevent the process from closing
    process.once("message", (m) => {
        config = m;
        main = new IFileDownloader(config);
        process.on("message", main.onMessage.bind(main));
    });
}

module.exports = FileDownloader;