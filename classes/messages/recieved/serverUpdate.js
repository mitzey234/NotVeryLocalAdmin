var message = require('../../message');
const util = require("../../util");

class serverUpdate extends message {
    id;

    data

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.data = data.data;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                util.setProperty(this.data.path, server.config, this.data.value);
            } catch (e) {
                this.core.error(`Error handling {path} config event {sid}: ${e}`, this.core.lp({sid: this.id, path: this.data.path, e: e?.code || e?.message || e, stack: e?.stack}));
            }
        }
    }
}

module.exports = serverUpdate;