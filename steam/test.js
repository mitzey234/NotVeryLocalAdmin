const Steam = require("./steam");
const { StateStrings } = require("./Util");

async function start () {
	let steam = new Steam();
	steam.on("login", () => console.log("Logged in to steam"));
	steam.on("disconnect", () => console.log("Disconnected from steam"));
	steam.on("error", e => console.error(e));
	steam.on("state", v => console.log("State: " + StateStrings[v]));
	await steam.hook(); // Waits for steam to be ready
	try {
		await steam.download(996560, "./app/");
	} catch (e) {
		return console.error("Something went wrong:", e);
	}
	console.log(await steam.availableBranches(996560));
	steam.destroy();
}

start();