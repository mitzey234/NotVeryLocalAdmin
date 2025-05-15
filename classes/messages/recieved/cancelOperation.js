var message = require('../../message');

class cancelOperation extends message {
    id;

    constructor(main, data) {
        super(main);
        this.id = data.id;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                this.core.log(`Web caneling operation {slabel}`, this.core.lp({sid: this.id, slabel: server.label}));
                server.cancelOperation();
            } catch (e) {
                this.core.error(`Error canceling operation on server {sid}: ${e}`, this.core.lp({sid: this.id, e: e?.code || e?.message || e, stack: e?.stack}));
            }
        }
    }
}

module.exports = cancelOperation;