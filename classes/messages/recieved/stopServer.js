var message = require('../../message');

class stopServer extends message {
    id;

    force;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.force = data.force;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                this.core.log(`Web stopping server {serverName}`, this.core.lp({sid: this.id, serverName: server.label}));
                server.shutdown(this.force);
            } catch (e) {
                this.core.error(`Error stopping server {sid}: ${e}`, this.core.lp({sid: this.id, e: e?.code || e?.message || e, stack: e?.stack}));
            }
        }
    }
}

module.exports = stopServer;