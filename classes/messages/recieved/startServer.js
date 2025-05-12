var message = require('../../message');

class startServer extends message {
    id;

    constructor(main, data) {
        super(main);
        this.id = data.id;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                this.core.log(`Web starting server {slabel}`, this.core.lp({sid: this.id, slabel: server.label}));
                server.start();
            } catch (e) {
                this.core.error(`Error starting server {sid}: ${e}`, this.core.lp({sid: this.id, e: e?.code || e?.message || e, stack: e?.stack}));
            }
        }
    }
}

module.exports = startServer;