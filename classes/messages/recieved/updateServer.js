var message = require('../../message');

class updateServer extends message {
    id;

    constructor(main, data) {
        super(main);
        this.id = data.id;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                this.core.log(`Web updating server {serverName}`, this.core.lp({sid: this.id, serverName: server.label}));
                server.update();
            } catch (e) {
                this.core.error(`Error updating server {id}: ${e}`, this.core.lp({sid: this.id, e: e?.code || e?.message || e, stack: e?.stack}));
            }
        }
    }
}

module.exports = updateServer;