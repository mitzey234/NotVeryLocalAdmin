const message = require('../../message');
const pack = require('../../../package.json');

class auth extends message {
    id;

    label;

    password;

    servers = {};

    state;

    version;

    constructor(main) {
        super(main);
        this.core.servers.forEach((server, id) => {
            this.servers[id] = server.toJSON()
            this.servers[id].state = server.state.toObject();
        });
        this.password = this.core.settings.Vega.password;
        this.label = this.core.settings.Vega.label;
        this.id = this.core.settings.Vega.id;
        this.state = this.core.state.toObject();
        this.version = pack.version;
    }

}

module.exports = auth;