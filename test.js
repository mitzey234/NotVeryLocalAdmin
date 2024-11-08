const CDN = require("./node_modules/steam-user/components/cdn.js");
const DefaultOptions = require('./node_modules/steam-user/resources/default_options.js');
const StdLib = require('@doctormckay/stdlib');
const FileManager = require('file-manager');
const SteamUser = require('steam-user');
const Package = require('./package.json');
const Path = require('path');
const FS = require('fs');
const EDepotFileFlag = require('./node_modules/steam-user/enums/EDepotFileFlag.js');
const { Client } = require('undici');
const EventEmitter = require('events');
const crypto = require('crypto');
const { Writable } = require('stream');
const { fork } = require('child_process');
const os = require('os');
const cpuCount = os.cpus().length;

const SteamOSs = {
    darwin: "macos",
    linux: "linux",
    win32: "windows"
}

function len (obj) {
    return Object.keys(obj).length;
}

function fileHash (path) {
	return new Promise((resolve, reject) => {
		let hash = crypto.createHash('sha1');
		let stream = FS.createReadStream(path);
		stream.on('error', reject);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function getHash (buffer) {
	return crypto.createHash('sha1').update(buffer).digest('hex');
}

class Content extends CDN {
	/**
	 * @param {OptionsObject} [options]
	 */
	constructor(options) {
		super();

		this.steamID = null;

		this._initProperties();
		this._connectTimeout = 1000;
		this._initialized = false;
		this._multiCount = 0;

		// App and package cache
		this._changelistUpdateTimer = null;
		this.picsCache = {
			changenumber: 0,
			apps: {},
			packages: {}
		};

		this.options = {};

		for (let i in (options || {})) {
			this._setOption(i, options[i]);
		}

		for (let i in DefaultOptions) {
			if (typeof this.options[i] === 'undefined') {
				this._setOption(i, DefaultOptions[i]);
			}
		}

		this._checkOptionTypes();

		if (!this.options.dataDirectory && this.options.dataDirectory !== null) {
			if (process.env.OPENSHIFT_DATA_DIR) {
				this.options.dataDirectory = process.env.OPENSHIFT_DATA_DIR + '/node-steamuser';
			} else {
				this.options.dataDirectory = StdLib.OS.appDataDirectory({
					appName: 'node-steamuser',
					appAuthor: 'doctormckay'
				});
			}
		}

		if (this.options.dataDirectory) {
			this.storage = new FileManager(this.options.dataDirectory);
		}

		this._initialized = true;
	}

	_initProperties(isConnecting) {
		// Account info
		this.limitations = null;
		this.vac = null;
		this.wallet = null;
		this.emailInfo = null;
		this.licenses = null;
		this.gifts = null;

		// Friends and users info
		this.users = {};
		this.groups = {};
		this.chats = {};
		this.myFriends = {};
		this.myGroups = {};
		this.myFriendGroups = {};
		this.myNicknames = {};
		this.steamServers = {};
		this.contentServersReady = false;
		this.playingState = {blocked: false, appid: 0};
		this._playingBlocked = false;
		this._playingAppIds = [];

		this._gcTokens = []; // game connect tokens
		this._activeAuthTickets = [];
		this._connectTime = 0;
		this._connectionCount = 0;
		this._authSeqMe = 0;
		this._authSeqThem = 0;
		this._hSteamPipe = Math.floor(Math.random() * 1000000) + 1;
		this._contentServerCache = {};
		this._contentServerTokens = {};
		this._lastNotificationCounts = {};
		this._sessionID = 0;
		this._currentJobID = 0;
		this._currentGCJobID = 0;
		this._jobs = new StdLib.DataStructures.TTLCache(1000 * 60 * 2); // job callbacks are cleaned up after 2 minutes
		this._jobsGC = new StdLib.DataStructures.TTLCache(1000 * 60 * 2);
		this._richPresenceLocalization = {};
		this._incomingMessageQueue = [];
		this._useMessageQueue = false; // we only use the message queue while we're processing a multi message
		this._ttlCache = new StdLib.DataStructures.TTLCache(1000 * 60 * 5); // default 5 minutes
		this._getCmListAttempts = 0;

		this._resetAllExponentialBackoffs(isConnecting);

		delete this._machineAuthToken;
		delete this._shouldAttemptRefreshTokenRenewal;
		delete this._loginSession;
		delete this._connectionClosed;

		clearTimeout(this._reconnectForCloseDuringAuthTimeout);
		delete this._reconnectForCloseDuringAuthTimeout;
	}

	get packageName() {
		return Package.name;
	}

	get packageVersion() {
		return Package.version;
	}

	/**
	 * Set a configuration option.
	 * @param {string} option
	 * @param {*} value
	 */
	setOption(option, value) {
		this._setOption(option, value);
		this._checkOptionTypes();
	}

	/**
	 * Set one or more configuration options
	 * @param {OptionsObject} options
	 */
	setOptions(options) {
		for (let i in options) {
			this._setOption(i, options[i]);
		}

		this._checkOptionTypes();
	}

	/**
	 * Actually commit an option change. This is a separate method since user-facing methods need to be able to call
	 * _checkOptionTypes() but we also want to be able to change options internally without calling it.
	 * @param {string} option
	 * @param {*} value
	 * @private
	 */
	_setOption(option, value) {
		this.options[option] = value;

		// Handle anything that needs to happen when particular options update
		switch (option) {
			case 'dataDirectory':
				if (this._initialized) {
					if (!this.storage) {
						this.storage = new FileManager(value);
					} else {
						this.storage.directory = value;
					}
				}

				break;

			case 'enablePicsCache':
				if (this._initialized) {
					this._resetChangelistUpdateTimer();
					this._getLicenseInfo();
				}

				break;

			case 'changelistUpdateInterval':
				if (this._initialized) {
					this._resetChangelistUpdateTimer();
				}

				break;

			case 'webCompatibilityMode':
			case 'protocol':
				if (
					(option == 'webCompatibilityMode' && value && this.options.protocol == SteamUser.EConnectionProtocol.TCP) ||
					(option == 'protocol' && value == SteamUser.EConnectionProtocol.TCP && this.options.webCompatibilityMode)
				) {
					this._warn('webCompatibilityMode is enabled so connection protocol is being forced to WebSocket');
				}
				break;

			case 'httpProxy':
				if (typeof this.options.httpProxy == 'string' && !this.options.httpProxy.includes('://')) {
					this.options.httpProxy = 'http://' + this.options.httpProxy;
				}
				break;
		}
	}

	/**
	 * Make sure that the types of all options are valid.
	 * @private
	 */
	_checkOptionTypes() {
		// We'll infer types from DefaultOptions, but stuff that's null (for example) needs to be defined explicitly
		let types = {
			socksProxy: 'string',
			httpProxy: 'string',
			localAddress: 'string',
			localPort: 'number',
			machineIdFormat: 'array'
		};

		for (let opt in DefaultOptions) {
			if (types[opt]) {
				// already specified
				continue;
			}

			types[opt] = typeof DefaultOptions[opt];
		}

		for (let opt in this.options) {
			if (!types[opt]) {
				// no type specified for this option, so bail
				continue;
			}

			let requiredType = types[opt];
			let providedType = typeof this.options[opt];
			if (providedType == 'object' && Array.isArray(this.options[opt])) {
				providedType = 'array';
			} else if (requiredType == 'number' && providedType == 'string' && !isNaN(this.options[opt])) {
				providedType = 'number';
				this.options[opt] = parseFloat(this.options[opt]);
			}

			if (this.options[opt] !== null && requiredType != providedType) {
				this._warn(`Incorrect type '${providedType}' provided for option ${opt}, '${requiredType}' expected. Resetting to default value ${DefaultOptions[opt]}`);
				this._setOption(opt, DefaultOptions[opt]);
			}
		}
	}

	/**
	 * Issue a warning
	 * @param msg
	 * @private
	 */
	_warn(msg) {
		process.emitWarning(msg, 'Warning', 'steam-user');
	}
}

class Downloader extends EventEmitter {
	/** @type Content */
	cdn;

	appId;

	servers = [];
	
	/** @type Array<Set> */
	locks = [];

	os = SteamOSs[process.platform] || "Unknown";

	depots = new Map();

	manifests = new Map();

	files = [];

	keys = new Map();

	totalBytes = 0;

	downloaded = 0;

	workers = new Set();

	constructor (cdn, appId) {
		super();
		this.cdn = cdn;
		this.appId = appId;
		this.on("process", () => console.log("Downloaded: " + this.downloaded + " / " + this.totalBytes, Math.round(this.downloaded / this.totalBytes * 10000)/100 + "%"));
		for (let i = 0; i < cpuCount; i++) {
			let worker = fork(Path.join(__dirname, 'decompressor.js'));
			worker.inProgress = new Map();
			this.workers.add(worker);
			worker.on("message", (msg) => {
				let work = worker.inProgress.get(msg.sha);
				if (work != null) {
					work(Buffer.from(msg.result.data));
					worker.inProgress.delete(msg.sha);
				}
			});
			worker.on("error", e => {
				console.error("Worker error", e);
				this.workers.delete(worker);
			});
			worker.on("exit", () => {
				this.workers.delete(worker);
			});
		}
	}

	async init () {
		try {
			this.product = await cdn.getProductInfo([this.appId], []);
		} catch (e) {
			console.error("Failed getting product info", e);
			return -1;
		}

		try {
			this.servers = (await this.cdn.getContentServers(this.appId))?.servers;
			this.servers.sort(function (a,b) {a.weightedload - b.weightedload}); // sort by weightedload
			for (let i in this.servers) {
				let server = this.servers[i];
				server.localId = i;
				let urlBase = (server.https_support == 'mandatory' ? 'https://' : 'http://') + server.Host;
				server.dispatcher = new Client(urlBase);
				this.locks[i] = new Set();
			}
		} catch (e) {
			console.error("Failed getting content servers", e);
			return -2;
		}
	}

	get availableServer () {
		let lowest = 100;
		for (let i in this.locks) if (this.locks[i].size < lowest) lowest = this.locks[i].size;
		for (let i in this.servers) {
			let server = this.servers[i];
			if (this.locks[i].size <= lowest && this.locks[i].size < 4) return server;
		}
		return null;
	}

	get availableWorker () {
		let lowest = 100;
		for (let worker of this.workers) if (worker.inProgress.size < lowest) lowest = worker.inProgress.size;
		for (let worker of this.workers) if (worker.inProgress.size <= lowest && worker.inProgress.size < 4) return worker;
		return null;
	}

	async getKey (depotId) {
		let key = this.keys.get(depotId);
		if (key != null) return key;
		let request = await this.cdn.getDepotDecryptionKey(this.appId, depotId);
		this.keys.set(depotId, request.key);
		return request.key;
	}

	async getManifests (branch = "public", betaPassword) {
		let depots = this.product.apps[this.appId].appinfo.depots;
		this.depots.clear();
		this.manifests.clear();
		for (let depotId in depots) {
			let depot = depots[depotId];
			if (len(depot) == 0 || isNaN(depotId)) continue;
			if (depot.config?.oslist != null && depot.config?.oslist.indexOf(this.os) == -1) continue;
			if (depot.config?.osarch != null && depot.config?.osarch != process.arch.replace("x", "")) continue;
			this.depots.set(depotId, depot);
		}
		console.log("Selected depots", this.depots.size);
		for (let [depotId, depot] of this.depots) {
			let manifestId;
			let depotBranch;
			if (depot.manifests == null && depot.encryptedmanifests) continue;
			if (depot.manifests != null && depot.manifests[branch] != null) {
				depotBranch = branch;
				manifestId = depot.manifests[branch].gid;
			} else if (depot.encryptedmanifests != null && depot.encryptedmanifests[branch] != null) {
				depotBranch = branch;
				if (betaPassword == null) {
					console.log("Branch requires password", branch, depotId);
					continue;
				}
				//use beta password here
				let keys = await cdn.getAppBetaDecryptionKeys(appId, betaPassword);
				//SymmetricDecryptECB against the gid using gid to buffer from hex
				//aes - ECB - PKCS7 - 256 - 128
				//Convert decoded buffer to UInt64 and put that into manifestId
			} else if (depot.manifests?.public != null) {
				manifestId = depot.manifests["public"].gid;
				depotBranch = "public";
			}
			if (manifestId == null) {
				console.log("No manifest found for", branch, depotId);
				continue;
			}
			let manifest;
			try {
				manifest = (await cdn.getManifest(depot.depotfromapp || this.appId, depotId, manifestId, depotBranch, null)).manifest;
			} catch (e) {
				console.error("Failed getting manifest: " + manifestId, e);
				continue;
			}
			manifest.app_id = depot.depotfromapp || this.appId;
			this.manifests.set(manifestId, manifest);
			console.log("Depot: " + manifest.depot_id, "Files: " + manifest.files.length, "Manifest ID: " + manifest.gid_manifest, this.manifests.size);
		}
		if (this.manifests.size == 0) return -1;
	}

	async getFiles () {
		if (this.manifests.size == 0) return -1;
		this.files = [];
		this.totalBytes = 0;
		for (let [id, manifest] of this.manifests) {
			let files = manifest.files;
			console.log(manifest.depot_id, manifest.files.length, manifest.gid_manifest);
			for (let i in files) {
				let file = files[i];
				this.files.push([manifest.app_id, manifest.depot_id, file]);
				this.totalBytes += parseInt(file.size);
				id;
			}
		}
		this.files.sort((a,b) => parseInt(b[2].size) - parseInt(a[2].size));
		console.log("Found " + this.files.length + " Files");
	}

	async processChunk (data, depot_id, chunk) {
		const res = Buffer.concat(data);
		let key = await this.getKey(depot_id);
		let worker = this.availableWorker;
		while (worker == null) {
			await new Promise(r => setTimeout(r, 200));	
			worker = this.availableWorker;
		}
		let prom = {resolve: null, reject: null};
		let promise = new Promise((r1, r2) => {prom.resolve = r1; prom.reject = r2});
		worker.inProgress.set(chunk.sha, prom.resolve);
		worker.send({res, sha: chunk.sha, key});
		return promise;
	}

	async downloadChunk (contentServer, appID, depot_id, chunk, fd) {
		let token = '';
		if (contentServer.usetokenauth == 1) token = (await this.cdn.getCDNAuthToken(appID, depot_id, contentServer.vhost || contentServer.Host)).token;
		var data = [];
		let options = {
			origin: contentServer.urlBase,
			path: `/depot/${depot_id}/chunk/${chunk.sha}${token}`,
			method: 'GET',
			headers: {
				'Host': contentServer.vhost || contentServer.Host,
				'User-Agent': 'DepotDownloader/2.7.3',
			},
			opaque: { data }
		};
		await contentServer.dispatcher.stream(options, ({ statusCode, opaque: { data } }) => {
			if (statusCode != 200) {
				console.error("Download status error:", statusCode);
				throw new Error("Download status error:", statusCode);
			}
			return new Writable({
				write (chunk, encoding, callback) {
					data.push(chunk)
					callback()
				}
			})
		});
		let result = await this.processChunk(data, depot_id, chunk);
		if (getHash(result) != chunk.sha) {
			throw new Error('Checksum mismatch');
		} else {
			this.downloaded += result.length;
			FS.writeSync(fd, result, 0, result.length, parseInt(chunk.offset));
		}
		this.emit("process", null);
	}

	async downloadFile (app_id, depot_id, file, targetPath, fd) {
		let proms = [];
		while (file.chunks.length > 0) {
			let chunk = file.chunks.shift();
			//console.log("Chunk (" + file.chunks.length + "): " + chunk.sha);
			var contentServer = this.availableServer;
			while (contentServer === null) {
				await new Promise(r => setTimeout(r, 50));
				contentServer = this.availableServer;
			}
			this.locks[contentServer.localId].add(chunk);
			let result = this.downloadChunk(contentServer, app_id, depot_id, chunk, fd)
			.catch(function (contentServer, chunk, e) {
				console.error("Something went wrong downloading chunk: " + chunk.sha, e);
				file.chunks.push(chunk);
			}.bind(this, contentServer, chunk))
			.finally(function (contentServer, chunk) {
				this.locks[contentServer.localId].delete(chunk);
			}.bind(this, contentServer, chunk));
			proms.push(result);
		}
		await Promise.all(proms);
		if (fd != null) FS.closeSync(fd);
		let fullpath = Path.join(targetPath, file.filename.replaceAll("\\", "/"));
		let sum = await fileHash(fullpath);
		if (sum != file.sha_content) throw new Error('File Checksum mismatch' + file.filename + " " + sum + " != " + file.sha_content);
		//console.log("Downloaded: " + file.filename, sum);
		this.emit("process", null);
	}

	async download (targetPath) {
		let proms = [];
		let concurrent = 0;
		var wait;
		while (this.files.length > 0 || concurrent > 0) {
			if (this.files.length == 0) {
				await Promise.all(proms);
				if (this.files.length == 0) break;
			}
			let file = this.files.shift();
			let fileManifest = file[2];
			let fullpath = Path.join(targetPath, fileManifest.filename.replaceAll("\\", "/"));
			if (fileManifest.flags & EDepotFileFlag.Directory) {
				if (FS.existsSync(fullpath) == false) FS.mkdirSync(fullpath, {recursive: true});    
				continue;
			}
			if (concurrent >= 4 ) await new Promise((r) => wait = r);
			//console.log("Downloading (" + this.files.length + "): " + fileManifest.filename);
			concurrent++;
			file[3] = targetPath;
			let test = Path.parse(fullpath);
			if (FS.existsSync(test.dir) == false) FS.mkdirSync(test.dir, {recursive: true});
			if (file[4] == null) {
				let mode;
				if ((fileManifest.flags & EDepotFileFlag.Executable) || (fileManifest.flags & EDepotFileFlag.CustomExecutable)) {
					mode = 0o777;
				} else {
					mode = 0o666;
				}
				if (FS.existsSync(fullpath)) {
					try {
						if (await fileHash(fullpath) == fileManifest.sha_content) {
							//console.log("File already exists: " + fileManifest.filename);
							this.downloaded += parseInt(fileManifest.size);
							this.emit("process", null);
							concurrent--;
							continue;
						}
					} catch {/* ignore */}
				}
				try {
					file[4] = FS.openSync(fullpath, 'w', mode);
					FS.ftruncateSync(file[4], parseInt(fileManifest.size));
				} catch (e) {
					console.error("Something went wrong creating the file: " + fileManifest.filename, e);
					concurrent--;
					continue;
				}
			}
			let result = this.downloadFile(...file).catch(e => {
				console.error("Something went wrong downloading file: " + fileManifest.filename, e);
				this.files.push(file);
			}).finally(() => {
				concurrent--;
				if (wait != null) {
					wait();
					wait = null;
				}
			});
			proms.push(result);
		}
		await Promise.all(proms);
		console.log("Finished", concurrent, wait);
		this.workers.forEach(w => w.kill()); // kill all workers
	}
}

var cdn = new Content();
cdn.on("error", console.error);
cdn.on("loggedOn", async function() {
    console.log("Logged on as", cdn.steamID.getSteamID64());
	let downloader = new Downloader(cdn, 996560);
	var status = null;
	status = await downloader.init();
	if (!isNaN(status) && status < 0) return console.log("Init failure");
	status = await downloader.getManifests("experimental");
	if (!isNaN(status) && status < 0) return console.log("Manifests get failure");
	status = await downloader.getFiles();
	if (!isNaN(status) && status < 0) return console.log("File get failure");
	status = await downloader.download("./app/");
	if (!isNaN(status) && status < 0) return console.log("Download failure");

	return;
});

cdn.logOn({anonymous: true});
globalThis.cdn = cdn;
