/* eslint-disable no-empty */
const core = require('./classes/core.js');
const fs = require('fs');
let args = process.argv.filter(i => i.trim() != "");
let LP = require('./classes/logging.js').LP;

/** @type {import("./classes/core.js")["Main"]["prototype"]} */
let main;

try {
    let d = new Date();
    console.log("----BEGIN | " + `${d.toTimeString().slice(0, 8)}.${d.getMilliseconds().toString().padStart(3, "0")}` + "----");
    main = new core.Main(args.includes("-d"));
} catch (e) {
    console.error("Error initializing main object" + (e.message != null ? " - " + e.message + ": " : ":") + e.stack);
    process.exit(1);
}

process.on('SIGINT', function() {
    main.log("Stop triggered by SIGINT");
    main.stop();
});

process.on("SIGUSR1", function() {
    main.log("Restart triggered by SIGUSR1");
    main.restart();
});

process.on('SIGQUIT', function() {
    main.log("Stop triggered by SIGINT");
    main.stop();
});

process.on("uncaughtException", handleCriticalFailure);
process.on("unhandledRejection", handleCriticalFailure);

function handleCriticalFailure (e) {
    console.error("Critical failure:", e);
    
    // Handle network connection errors that should not kill the service
    if (e.code == "ECONNRESET" || e.code == "ECONNREFUSED" || e.code == "ETIMEDOUT" || e.code == "EPIPE") {
        console.error("Network error (non-fatal):", e.code, e.message);
        console.trace();
        try {
            fs.appendFileSync('networkErrors.log', `[${new Date().toISOString()}] ${e.code}: ${e.message}\n${e.stack}\n\n`);
        } catch {
            console.error("Failed to log network error");
        } // Ignore logging errors
        return; // Don't exit - allow reconnection logic to handle it
    }
    
    // Critical errors that should terminate the process
    setTimeout(process.exit.bind(null, -1), 1000);
    fs.writeFileSync('crashLog.txt', e.stack + "\n" + e.message);
    process.exit(1);
}


var stdin = process.openStdin();
stdin.addListener("data", function(d) {
	var test = d.toString();
	try {
		//TODO: evaluate(test);
	} catch (e) {
		main.log("Failed user input: {input} - {e}", new LP({input: test, e: e.code || e.message, stack: e.stack}));
	}
});
