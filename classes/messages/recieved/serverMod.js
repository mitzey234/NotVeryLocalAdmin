var message = require('../../message');

class serverMod extends message {
    id;

    lastMod;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.lastMod = data.lastMod;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) server.lastModified = this.lastMod;
    }
}

module.exports = serverMod;