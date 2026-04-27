const Module = require("./module");
const os = require('os');
const osAlt = require('os-utils');
const util = require("./util");

module.exports = class MemoryMonitor extends Module {
  interval;

  constructor (core){
    super(core);
    this.interval = setInterval(this.checkMemory.bind(this), 250);
    this.checkMemory();
  }

  minimumThreashPrompt = false;

  criticalThreashPrompt = false;

  get lowMemory () {
    return this.main.state.lowMemory;
  }

  set lowMemory (v) {
    if (this.main.state.lowMemory == v) return;
    this.main.state.lowMemory = v;
  }

  get totalMemory () {
    return this.main.state.totalMemory;
  }

  set totalMemory (v) {
    if (this.main.state.totalMemory == v) return;
    this.main.state.totalMemory = v;
  }

  get memory () {
    return this.main.state.memory;
  }

  set memory (v) {
    if (this.main.state.memory == v) return;
    this.main.state.memory = v;
  }

  async checkMemory () {
    //If system has less than or equal to 100MB of free memory, investigate
    let currentFree = os.freemem();
    let total = osAlt.totalmem();
    this.totalMemory = total*1000000;
    this.memory = (total-osAlt.freemem())*1000000;
    if (!this.main.settings.memoryChecker) return;
    if (currentFree < this.main.settings.minimumMemoryThreashold && currentFree > this.main.settings.criticalMemoryThreashold) {
      if (this.minimumThreashPrompt == false) {
        this.minimumThreashPrompt = true;
        this.log("Warning system memory is below minimum threashold: {formatedBytes}", this.main.lp({bytes: currentFree, formatedBytes: util.formatBytes(currentFree)}));
      }
      var s = [];
      this.main.servers.forEach(server => {
        if (server.process != null && server.state.memory != null) {
          s.push({uid: server.config.id, bytes: server.state.memory, used: Math.round(server.state.memory/(os.totalmem()-currentFree)*100)});
        }
      });
      s.sort(function (a,b){return b.bytes-a.bytes});
      if (s.length > 0) {
        for (let i in s) {
          let server = this.main.servers.get(s[i].uid);
          if (server.state.delayedRestart == false && server.state.restarting == false && server.state.stopping == false && server.state.delayedStop == false && server.state.starting == false) {
            this.log("Restarting server {label} in attempt to save memory! - {formatedBytes}", this.main.lp({label: server.config.label, serverId: server.config.id, bytes: s[i].bytes, formatedBytes: util.formatBytes(s[i].bytes)}));
            let result = await server.restart(false);
            if (typeof result == "number") {
              this.main.error("Failed to restart server: {result}", this.main.lp({result: result}));
              result = await server.restart(true);
              if (typeof result == "number") {
                this.main.error("Failed to restart server with force: {result}", this.main.lp({result: result}));
              }
            }
            else break;
          } else break;
        }
      }
    } else if (currentFree < this.main.settings.criticalMemoryThreashold) {
      if (this.criticalThreashPrompt == false) {
        this.criticalThreashPrompt = true;
        this.log("Warning system memory is below CRITCAL threashold: {formatedBytes}", this.main.lp({bytes: currentFree, formatedBytes: util.formatBytes(currentFree)}));
      }
      this.lowMemory = true;
      s = [];
      this.main.servers.forEach(server => {
        if (server.process != null && server.state.memory != null) {
          s.push({uid: server.config.id, bytes: server.state.memory, used: Math.round(server.state.memory/(os.totalmem()-currentFree)*100)});
        }
      });
      s.sort(function (a,b){return b.bytes-a.bytes});
      if (s.length > 0) {
        for (let i in s) {
          let server = this.main.servers.get(s[i].uid);
          if (server.process != null && (server.state.restarting == true || server.state.stopping == true || server.state.starting) && currentFree < 25000000) {
            this.log("Killing server {label} in attempt to save memory! - {formatedBytes}", this.main.lp({label: server.config.label, serverId: server.config.id, bytes: s[i].bytes, formatedBytes: util.formatBytes(s[i].bytes)}));
            try {
              if (server.state.restarting == false && server.state.delayedRestart == false) server.state.stopping = true;
              server.process.kill();
            } catch {} //Ignore failures
            break;
          } else break;
        }
      }
    } else {
      //No memory issues detected
      if (this.lowMemory == true) this.lowMemory = false;
      if (this.minimumThreashPrompt == true) this.minimumThreashPrompt = false;
      if (this.criticalThreashPrompt == true) this.criticalThreashPrompt = false;
    }
  }
}