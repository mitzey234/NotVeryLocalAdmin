var message = require('../../message');
const Server = require('../../server.js');

class installServer extends message {

    config;

    constructor(main, data) {
        super(main);
        this.config = data.config;
    }

    handle () {
        let server = this.config;

        //Create server
        let s;
        if (!this.core.servers.has(server.id)) s = new Server(this.core, server);
        //Update the server config if it already exists
        else {
            s = this.core.servers.get(server.id);
            s.config.update(server);
            if (!s.configured || s.lastModified != server.lastModified) s.configure();
        }
        s.lastModified = server.lastModified;
    }
}

module.exports = installServer;