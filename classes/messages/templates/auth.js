const message = require('../../message');
const pack = require('../../../package.json');

class auth extends message {
    id;

    label;

    password;

    servers = {};

    state;

    version;

    echoPort;

    addresses;

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
        this.echoPort = this.core.EchoServer.currentPort;
        if (this.echoPort != null) this.addresses = this.core.addresses;
        else this.addresses = null;
    }

}

module.exports = auth;