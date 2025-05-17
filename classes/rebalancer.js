const os = require('os');
let availableCpus = os.cpus().length;
let runCommand = require('./util').runCommand;
let convertToMask = require('./util').convertToMask;
let LP = require('./logging.js').LP;

class Rebalancer {
    /** @type import("./core")["Main"]["prototype"] */
    main;
  
    cpuBalancingSupported = false;
  
    cpuRebalanceInProg = false;
  
    constructor (m){
        this.main = m;
        this.log = this.main.log;
        this.error = this.main.error;
        this.verbose = this.main.debug;
        this.warn = this.main.warn;

        if (this.main.settings.cpuBalance) {
            this.log("CPU balancing is enabled, checking taskset");
            this.checkTaskSet();
        }
    }
  
    async checkTaskSet() {
        let exitcode = await runCommand('taskset -V');
        if (exitcode != 0) {
            this.error("Taskset is not available on this system");
            this.cpuBalancingSupported = false;
        } else {
            this.log("Taskset is available on this system");
            this.cpuBalancingSupported = true;
        }
    }
  
    async rebalanceServers() {
        if (!this.main.settings.cpuBalance || !this.cpuBalancingSupported) return;
        while (this.cpuRebalanceInProg) await new Promise(r => setTimeout(r, 500));
        this.verbose("CPU rebalancing servers");
        this.cpuRebalanceInProg = true;
        let currentCount = 0;
        let primeCpus = new Map();
        for (let y = 0; y < availableCpus; y++) primeCpus.set(y, 0);
        for (var entry of this.main.servers.entries()) {
            var server = entry[1];
            if (!server.state.running || server.process == null || server.process.pid == null) continue;
            let cpus = [];
            for (let x = 0; x < this.main.settings.cpusPerServer; x++) {
                let cpu = currentCount % availableCpus;
                if (!cpus.includes(cpu)) cpus.push(cpu);
                currentCount++;
            }
            cpus.sort(function (a, b) {
                return primeCpus.get(a) - primeCpus.get(b);
            }.bind(primeCpus));
            var main = cpus[0];
            primeCpus.set(main, primeCpus.get(main) + 1);
            var secondaries = cpus.filter(x => x != main);
            let commands = [];
            try {
                commands.push("taskset -a -p " + convertToMask(secondaries) + " " + server.process.pid);
                commands.push("taskset -p " + convertToMask(main) + " " + server.process.pid);
            } catch (e) {
                this.error("Failed generating mask for: {main} {secondaries} {server}\n{error}", new LP({ main: main, secondaries: secondaries, server: server != null ? server.config.label : "null", error: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
            }
            for (let v in commands) {
                let command = commands[v];
                try {
                    let exitCode = await runCommand(command);
                    if (exitCode != 0) throw "Error occured setting the process afffinity";
                    this.log("CPU Affinity set - " + command);
                } catch (e) {
                    this.error("Failed running command: {command}\n{error}", new LP({ command: command, error: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
                }
            }
        }
        this.cpuRebalanceInProg = false;
    }
  
    async resetServerBalance() {
        while (this.cpuRebalanceInProg) await new Promise(r => setTimeout(r, 500));
        this.cpuRebalanceInProg = true;
        for (var entry of this.main.servers.entries()) {
            var server = entry[1];
            if (!server.state.running || server.process == null || server.process.pid == null) continue;
            let cpus = [];
            for (let x = 0; x < availableCpus; x++) cpus.push(x);
            let commands = [];
            try {
                commands.push("taskset -a -p " + convertToMask(cpus) + " " + server.process.pid);
            } catch (e) {
                this.error("Failed generating mask for: {main} {server}\n{error}", new LP({ main: cpus, server: server != null ? server.config.label : "null", error: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
            }
            for (let v in commands) {
                let command = commands[v];
                try {
                    let exitCode = await runCommand(command);
                    if (exitCode != 0) throw "Error occured setting the process afffinity";
                    this.log("CPU Affinity set - " + command);
                } catch (e) {
                    this.error("Failed running command: {command}\n{error}", new LP({ command: command, error: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e }));
                }
            }
        }
        this.cpuRebalanceInProg = false;
    }
}

module.exports = Rebalancer;