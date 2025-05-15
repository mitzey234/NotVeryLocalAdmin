const path = require("path");
const chokidar = require("chokidar");
const EventEmitter = require("events");
const LP = require("./logging").LP;
var verkeyPath = process.platform == "win32" ? path.join(process.env.APPDATA, "SCP Secret Laboratory", "verkey.txt") : path.join(process.env.HOME, ".config", "SCP Secret Laboratory", "verkey.txt");
const VerkeyUpdate = require("./messages/templates/verkeyUpdate");

class VerkeyWatcher extends EventEmitter {

    /** @type import("./core")["Main"]["prototype"] */
    main;

    constructor(m) {
        super();
        this.main = m;
        this.watch = chokidar.watch(path.parse(verkeyPath).dir, { ignoreInitial: true, persistent: true });
        this.watch.on("all", this.userSCPSLAppdateUpdate.bind(this));
        this.watch.on("error", e => this.main.error("File Watch Error: {error}", new LP({ error: e != null ? e.code || e.message || e : e, stack: e != null ? e.stack : e })));
    }

    async userSCPSLAppdateUpdate(event, filePath) {
        if (this.main.stopping) return;
        filePath = path.relative(path.parse(verkeyPath).dir, filePath);
        if (path.parse(filePath).ext != path.parse(verkeyPath).ext || path.parse(filePath).name != path.parse(verkeyPath).name) return;
        this.emit("update", this.main.verkey);
        this.main.vega.send(new VerkeyUpdate(this.main.vega, this.main.verkey));
        this.main.log("File event: {event} {filePath}", new LP({ event: event, filePath: filePath }, { color: 6 }));
    }
}

module.exports = VerkeyWatcher;