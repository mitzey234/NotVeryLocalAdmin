var message = require('../../message');

class restartServer extends message {
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
                this.core.log(`Web restarting server {slabel}`, this.core.lp({sid: this.id, slabel: server.label}));
                server.restart(this.force);
            } catch (e) {
                this.core.error(`Error restarting server {sid}: ${e}`, this.core.lp({sid: this.id, e: e?.code || e?.message || e, stack: e?.stack}));
            }
        }
    }
}

module.exports = restartServer;