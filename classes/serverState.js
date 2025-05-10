const Util = require("./util");
const EventEmitter = require("events");

class ServerState extends EventEmitter {
    updatePending = false;
    updating = false;
    installing = false;
    uninstalling = false;
    restarting = false;
    configuring = false;
    starting = false;
    stopping = false;
    running = false;
    delayedRestart = false;
    delayedStop = false;
    idleMode = false;
    transfering = false;
    percent = -1;
    uptime = -1;
    players = -1;
    tps = -1;
    roundStartTime = -1;
    memory = -1;
    downloadingCount = -1;
    /** fractional cpu usage */
    cpu = -1;
    
    steam = null;
    error = null;
    
    constructor() {
        super();
        Util.processObjectShallow(this);
    }
  
    toObject () {
        return Util.filterSerializableProperties(this);
    }
}

module.exports = ServerState;