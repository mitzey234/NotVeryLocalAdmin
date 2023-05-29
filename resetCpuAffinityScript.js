var ps = require('ps-node');

const { exec } = require('node:child_process')
const os = require('os');
let servers = [];
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
    
    for (let i in servers) {
        let server = servers[i];
        let cpus = [];
        for (let x = 0; x < availableCpus; x++) if (!cpus.includes(x)) cpus.push(x);
        let commands = [];
        try {
            commands.push("taskset -a -p " + convertToMask(cpus) + " " + server.pid);
        } catch (e) {
            console.error("Failed generating mask for ", cpus , server != null ? server.pid : "null");
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
        console.log(cpus, commands);
    }
}

main();