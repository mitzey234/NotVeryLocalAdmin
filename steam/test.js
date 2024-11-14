const Steam = require("./steam");
const { StateStrings } = require("./Util");

async function start () {
	let steam = new Steam();
	steam.on("login", () => console.log("Logged in to steam"));
	steam.on("disconnect", () => console.log("Disconnected from steam"));
	steam.on("error", e => console.error(e));
	steam.on("state", v => console.log("State: " + StateStrings[v]));
	steam.on("progress", p => console.log("Progress: " + (p.downloaded != null && p.total != null ? + p.downloaded + "/" + p.total + " " + (Math.round(p.downloaded/p.total*10000)/100) + "%" : "null")));
	await steam.hook(); // Waits for steam to be ready
	try {
		await steam.download(996560, "./app/");
		console.log("Completed");
	} catch (e) {
		console.error("Something went wrong:", e);
	}
	//console.log(await steam.availableBranches(996560));
	steam.destroy();
}

start();