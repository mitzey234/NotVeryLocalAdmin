var ps = require('ps-node');

const { exec } = require('node:child_process')
const os = require('os');
let servers = [];

let cpusPerServer = 2;
let availableCpus = os.cpus().length;

function convertToMask (cpus) {
    if (typeof cpus == "object" && Array.isArray(cpus)) {
        let sum = 0;
        for (i in cpus) sum += Math.pow(2,cpus[i]);
        return sum.toString(16);
    } else if (typeof cpus == "number") {
        return Math.pow(2,cpus).toString(16);
    } else {
        throw "Unsupported type:" + typeof cpus;
    }
}

function runCommand (command) {
    return new Promise(function (resolve, reject) {
        let run = exec(command);
        run.on("close", resolve);
    }.bind(command));
}

async function checkTaskSet () {
    let exitcode = await runCommand('taskset -V');
    if (exitcode != 0) {
        console.log("Taskset is not available on this system");
        process.exit(1);
    } else {
        console.log("Taskset available");
    }
}

async function checkPs () {
    return new Promise(function (resolve, reject) {
        ps.lookup({command: 'SCPSL'},
            function(err, resultList) {
                if (err) this.reject(err);
                this.resolve(resultList);
            }.bind({reject: reject, resolve: resolve})
        );
    });
}

async function main () {
    await checkTaskSet();
    let res;
    try {
        res = await checkPs();
    } catch (e) {
        console.error("Error finding servers", e);
        process.exit(3);
    }
    if (res == null || typeof res != "object" || !Array.isArray(res)) {
        console.log("Error finding servers");
        process.exit(2);
    }
    if (res.length == 0) {
        console.log("No servers found");
        process.exit(1);
    }
    console.log("Got:", res.length, "servers");
    for (i in res) {
        let server = res[i];
        servers.push({pid: server.pid, label: "test"});
    }
    
    let currentCount = 0;
    let primeCpus = new Map();
    for (let y = 0; y < availableCpus; y++) primeCpus.set(y, 0);
    for (let i in servers) {
        let server = servers[i];
        let cpus = [];
        for (let x = 0; x < cpusPerServer; x++) {
            let cpu = currentCount%availableCpus;
            if (!cpus.includes(cpu)) cpus.push(cpu);
            currentCount++;
        }
        cpus.sort(function (a,b) {
            return primeCpus.get(a)-primeCpus.get(b);
        }.bind(primeCpus));
        var main = cpus[0];
        primeCpus.set(main, primeCpus.get(main)+1);
        var secondaries = cpus.filter(x => x != main);
        let commands = [];
        try {
            commands.push("taskset -a -p " + convertToMask(secondaries) + " " + server.pid);
            commands.push("taskset -p " + convertToMask(main) + " " + server.pid);
        } catch (e) {
            console.error("Failed generating mask for ", main, secondaries, server != null ? server.pid : "null");
        }
        for (let v in commands) {
            let command = commands[v];
            try {
                let exitCode = await runCommand(command);
                if (exitCode != 0) throw "Error occured setting the process afffinity";
            } catch (e) {
                console.error("Failed running command: " + command, e);
            }
        }
        console.log(main, secondaries, commands);
    }
}

main();