const CDN = require("./cdn");
const Util = require("./Util");
const Worker = require("./fileDownloader");
const settings = require("./settings");
const EventEmitter = require('events');
const Path = require('path');
const Branch = require("./branch");
const Depot = require("./depot");
const ContentServer = require("./contentServer");
const Manifest = require("./manifest").Manifest;
const File = require("./manifest").File;
const EDepotFileFlag = require('steam-user/enums/EDepotFileFlag.js');
const { States } = require("./Util");
const FS = require('fs');

class Steam extends EventEmitter {
    /** @type settings */
    config;

    /** @type CDN */
    cdn;

    os = Util.SteamOSs[process.platform] || "Unknown";

    /** @type Array<Worker> */
    workers = [];

    workerHooks = [];

    _state = States.Connecting;

    get state () {
        return this._state;
    }
    
    set state (v) {
        if (this._state === v) return;
        this._state = v;
        this.emit("state", v);
    }

    /** @type number | null */
    _downloaded = null;

    get downloaded () {
        return this._downloaded;
    }

    set downloaded (v) {
        if (this._downloaded === v) return;
        this._downloaded = v;
        this.emit("progress", {total: this.totalSize, downloaded: this._downloaded}); // Emit the progress event
    }

    /** @type number | null */
    totalSize = null;

    get availableWorker () {
        for (let i in this.workers) if (this.workers[i].process != null && this.workers[i].file == null) return this.workers[i];
        return null;
    }

    constructor (config = new settings()) {
        super();
        this.config = config;
        this.cdn = new CDN(); // Initialize the CDN instance
        this.cdn.on("error", this.onError.bind(this));
        this.cdn.on("disconnected", this.onDisconnect.bind(this));
        this.cdn.on("loggedOn", this.onLogin.bind(this));
        //console.log("Logging in");
        this.cdn.logOn({anonymous: true});
    }

    //TODO: Logging system

    hook () {
        if (this.hooks == null) this.hooks = [];
        let promise = new Promise((r) => this.hooks.push(r));
        return promise;
    }

    workerHook () {
        let promise = new Promise((r) => this.workerHooks.push(r));
        return promise;
    }

    /**
     * @param {Worker} worker 
     * @returns 
     */
    onFileComplete (worker) {
        if (this.workerHooks.length == 0) return worker.reset(); //No files are waiting
        let hook = this.workerHooks.shift(); //Get the next waiting file
        hook(worker); // Resolve the hook
    }

    reset () {
        if (this.state != States.Disconnected && this.state != States.Destroying) this.state = States.Ready;
        this.product = null;
        this.depots = null;
        this.appId = null;
        this.keys = null;
        this.manifests = null;
        this.servers = null;
        this.downloaded = null;
        this.totalSize = null;
        for (let i in this.workers) this.workers[i].stop();
        this.workers = [];
    }

    async getDepots () {
        /** @type Map<string, Depot> */
        let result = new Map();
        let depots = this.product.apps[this.appId].appinfo.depots;
        for (let depotId in depots) {
            let depot = depots[depotId];
            if (Util.len(depot) == 0 || isNaN(depotId)) continue;
            if (depot.config?.oslist != null && depot.config?.oslist.indexOf(this.os) == -1) continue;
            if (depot.config?.osarch != null && depot.config?.osarch != process.arch.replace("x", "")) continue;
            result.set(depotId, new Depot(depot));
        }
        return result;
    }

    async getKeys () {
        /** @type Map<string, Buffer> */
        let keys = new Map();
        for (let [i, t] of this.depots) {
            let app = t.depotfromapp || this.appId;
            keys.set(i+"-"+app, (await this.cdn.getDepotDecryptionKey(app, i)).key);
        }
        return keys;
    }

    async getManifests (branch = "public", betaPassword) {
        /** @type Map<string, Manifest> */
        let manifests = new Map();
		for (let [depotId, depot] of this.depots) {
			let manifestId;
			let depotBranch;
			if (depot.manifests == null && depot.encryptedmanifests == null) continue;
			if (depot.manifests != null && depot.manifests.has(branch)) {
				depotBranch = branch;
				manifestId = depot.manifests.get(branch).gid;
			} else if (depot.encryptedmanifests != null && depot.encryptedmanifests.has(branch) != null) {
				depotBranch = branch;
				if (betaPassword == null) throw new Error("Branch requires password: " + branch + " - " + depotId);
				//use beta password here
                let betas;
                try {
                    betas = await this.cdn.getBetasFromPassword(this.appId, betaPassword);
                } catch (e) {
                    if (e.eresult == 2) throw new Error("Failed to validate password");
                    else throw e;
                }
                if (betas.betapasswords.length == 0 || betas.betapasswords.filter(b => b.betaname == branch).length == 0) throw new Error("Invalid beta password for: " + branch + " - " + depotId);
                let key = betas.betapasswords.filter(b => b.betaname == branch)[0].betapassword;
                depotBranch = branch;
                manifestId = depot.manifests.get(branch).decrypt(key).gid;
			} else if (depot.manifests?.has("public")) {
				manifestId = depot.manifests.get("public").gid;
				depotBranch = "public";
			}
			if (manifestId == null) continue;
			let manifest = new Manifest((await this.cdn.getManifest(depot.depotfromapp || this.appId, depotId, manifestId, depotBranch, betaPassword)).manifest)
            manifest.files.forEach(f => this.totalSize += parseInt(f.size));
			manifest.app_id = depot.depotfromapp || this.appId;
			manifests.set(manifestId, manifest);
		}
		if (manifests.size == 0) throw new Error("No manifests found");
        return manifests;
	}

    async getServers (appId) {
        /** @type Array<ContentServer> */
        let servers = (await this.cdn.getContentServers(appId))?.servers;
        servers.map(s => new ContentServer(s));
        servers.sort(function (a,b) {a.weightedload - b.weightedload}); // sort by weightedload
        return servers.filter(s => s.usetokenauth != 1);
    }

    /**
     * @param {Manifest} manifest 
     * @param {File} file
     */
    async getFile (manifest, file, targetPath) {
        let fullpath = Path.join(targetPath, file.filename.replaceAll("\\", "/"));
        if (file.flags & EDepotFileFlag.Directory) {
            if (FS.existsSync(fullpath) == false) FS.mkdirSync(fullpath, {recursive: true});    
            return true;
        }

        if (FS.existsSync(fullpath)) {
            try {
                if (await Util.fileHash(fullpath) == file.sha_content) {
                    this.downloaded += parseInt(file.size);
                    //console.log("File already exists: " + file.filename);
                    return true;
                }
            } catch {/* ignore */}
        }

        let worker = this.availableWorker;
        if (worker == null && this.workers.length > 0) worker = await this.workerHook();
        if (worker == null && this.workers.length == 0) throw new Error("No workers available");
        else if (worker == null) throw new Error("Worker destroyed");
        if (worker.stopping) throw new Error("Worker is stopping");
        worker.reset();
        worker.file = file;
        worker.appId = manifest.app_id;
        worker.depotId = manifest.depot_id;
        worker.servers = this.servers;
        worker.keys = this.keys.get(manifest.depot_id+"-"+manifest.app_id);
        worker.targetPath = targetPath;
        await worker.hook();
        return true;
    }

    startWorker () {
        let worker = new Worker(this.config);
        worker.on("finish", this.onFileComplete.bind(this, worker)); // Handle file completion
        worker.on("chunkComplete", chunk => this.downloaded += chunk.cb_original);
        worker.on("error", this.onError.bind(this)); // Handle worker errors
        this.workers.push(worker); // Initialize file workers
    }

    async download(appId, targetPath = "./", branch = "public", password) {
        if (appId == null || isNaN(appId)) throw new Error("Invalid app id"); // Check if the app id is valid
        if (this.state != States.Ready) throw new Error("Steam is not ready"); // Check if Steam is ready
        if (branch == null) branch = "public"; // Set the branch to public if it's not defined
        if (typeof branch != "string") throw new Error("Invalid branch"); // Check if the branch is valid
        if (typeof appId == "string") appId = parseInt(appId);
        if (password != null && typeof password != "string") throw new Error("Invalid password format"); // Check if the password is valid
        
        this.state = States.StartingWorkers;
        if (this.workers.length == 0) for (let i = 0; i < this.config.fileWorkers; i++) this.startWorker();

        this.appId = appId;

        //Get App info
        this.state = States.GettingAppInfo;
        try {
            this.product = await this.cdn.getProductInfo([appId], []);
        } catch (e) {
            this.reset(); // Reset the state if there's an error
            throw e; //Pass the error along
        }

        //Get available depots
        this.state = States.GettingDepots;
        try {
            this.depots = await this.getDepots();
        } catch (e) {
            this.reset(); // Reset the state if there's an error
            throw e; //Pass the error along
        }

        //Get required keys
        this.state = States.GettingKeys;
        try {
            this.keys = await this.getKeys();
        } catch (e) {
            this.reset(); // Reset the state if there's an error
            throw e; //Pass the error along
        }

        //Get manifests
        this.state = States.GettingManifests;
        this.totalSize = 0;
        try {
            this.manifests = await this.getManifests(branch, password);
        } catch (e) {
            this.reset(); // Reset the state if there's an error
            throw e; //Pass the error along
        }

        //Get content servers
        this.state = States.GettingServers;
        try {
            this.servers = await this.getServers(appId);
        } catch (e) {
            this.reset(); // Reset the state if there's an error
            throw e; //Pass the error along
        }

        //Start downloading
        this.state = States.Downloading;
        let proms = [];
        this.downloaded = 0;
        for (let [id, manifest] of this.manifests) manifest.files.forEach(file => proms.push(this.getFile(manifest, file, targetPath).catch((e) => {return e})));
        proms = await Promise.all(proms);
        if (proms.some(e => e != true)) {
            this.reset(); // Reset the state if there's an error
            let e = new Error("Failed to download app");
            e.proms = proms.filter(e => e != true);
            if (this.state == States.Destroying) e = new Error("Download was canceled");
            throw e; //Pass the error along
        }
        this.reset();
        //console.log("Done");
        return true;
    }

    async availableBranches (appId) {
        if (this.cdn == null || this.state == States.Disconnected) throw new Error("Steam is not available");
        this.product = await this.cdn.getProductInfo([appId], []);
        /** @type Array<Branch> */
        let branches = [];
        for (let i in await this.product.apps[appId].appinfo.depots.branches) branches.push(new Branch(this.product.apps[appId].appinfo.depots.branches[i], i));
        return branches;
    }

    onDisconnect () {
        this.emit("disconnect");
    }

    onLogin () {
        this.emit("login");
        this.state = States.Ready;
        if (this.hooks != null) {
            this.hooks.forEach(hook => hook()); // Resolve all hooks
            this.hooks = null;
        }
    }

    onError (e) {
        this.emit("error", e); // Emit the error event
    }

    destroy() {
        if (this.state == States.Destroying) return;
        this.state = States.Destroying;
        for (let i in this.workers) this.workers[i].stop();
        while (this.workerHooks.length > 0) this.workerHooks.shift()();
        this.cdn.logOff();
        this.cdn = null;
    }
}

module.exports = Steam;
