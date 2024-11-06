const CDN = require("./node_modules/steam-user/components/cdn.js");
const DefaultOptions = require('./node_modules/steam-user/resources/default_options.js');
const StdLib = require('@doctormckay/stdlib');
const FileManager = require('file-manager');
const SteamUser = require('steam-user');
const Package = require('./package.json');
const Path = require('path');
const FS = require('fs');
const EDepotFileFlag = require('./node_modules/steam-user/enums/EDepotFileFlag.js');

const SteamOSs = {
    darwin: "macos",
    linux: "linux",
    win32: "windows"
}

var user = new SteamUser();
user.on("error", console.error);
user.logOn({anonymous: true});

function len (obj) {
    return Object.keys(obj).length;
}

class Content extends CDN {
	/**
	 * @param {OptionsObject} [options={}]
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

var cdn = new Content();
cdn.on("error", console.error);
cdn.on("loggedOn", async function() {
    console.log("Logged on as", cdn.steamID.getSteamID64());
    let branch = "public";
    let appId = 996560;
    let betaPassword = null;
    let targetPath = "./app/";
    let os = SteamOSs[process.platform] || "Unknown";
    //console.log(await cdn.getAppBetaDecryptionKeys(appId, "early-server-build"));
    let depots = new Map();
    let product = await cdn.getProductInfo([appId], []);
    let source = product.apps[appId].appinfo.depots;
    for (let depotId in source) {
        let depot = source[depotId];
        if (len(depot) == 0 || isNaN(depotId)) continue;
        if (depot.config?.oslist != null && depot.config?.oslist.indexOf(os) == -1) continue;
        if (depot.config?.osarch != null && depot.config?.osarch != process.arch.replace("x", "")) continue;
        depots.set(depotId, depot);
    }
    //console.log("Selected depots", depots);
    depots.forEach(async (depot, depotId) => {
        let manifestId;
        let depotBranch;
        if (depot.manifests[branch] != null) {
            depotBranch = branch;
            manifestId = depot.manifests[branch].gid;
        } else if (depot.encryptedmanifests[branch] != null) {
            depotBranch = branch;
            if (betaPassword == null) return console.log("Branch requires password", branch, depotId);
            //use beta password here
            let keys = await cdn.getAppBetaDecryptionKeys(appId, betaPassword);
            //SymmetricDecryptECB against the gid using gid to buffer from hex
            //aes - ECB - PKCS7 - 256 - 128
            //Convert decoded buffer to UInt64 and use that as the gid
        } else if (depot.manifests["public"] != null) {
            manifestId = depot.manifests["public"].gid;
            depotBranch = "public";
        }
        if (manifestId == null) {
            console.log("No manifest found for", branch, depotId);
            return;
        }
        let manifest = (await cdn.getManifest(depot.depotfromapp || appId, depotId, manifestId, depotBranch, null)).manifest;
        let files = manifest.files;
        console.log(manifest.depot_id, manifest.files.length, manifest.gid_manifest);
        for (let i in files) {
            let file = files[i];
            let fullpath = Path.join(targetPath, file.filename.replaceAll("\\", "/"));
            if (file.flags & EDepotFileFlag.Directory) {
                if (FS.existsSync(fullpath) == false) FS.mkdirSync(fullpath, {recursive: true});    
                continue;
            }
            let path = file.filename;
            let size = file.size;
            let hash = file.sha;
            let flags = file.flags;
            let chunks = file.chunks;
            let chunkCount = chunks.length;
            let test = Path.parse(fullpath);
            if (FS.existsSync(test.dir) == false) FS.mkdirSync(test.dir, {recursive: true});
            console.log(path, size, hash, flags, chunkCount);
            await cdn.downloadFile(appId, depotId, file, Path.join(targetPath, file.filename.replaceAll("\\", "/")));
        }
        console.log("Downloaded", files.length, "files from " + depotId);
    });

});

cdn.logOn({anonymous: true});
globalThis.cdn = cdn;