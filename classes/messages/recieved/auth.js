var message = require('../../message');
var RequestServers = require('../templates/requestServers.js');

class auth extends message {
    id;

    pass;

    reason;

    key;

    port;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.pass = data.pass;
        this.reason = data.reason;
        this.key = data.key;
        this.port = data.port;
    }

    handle () {
        if (this.pass == false) return this.error("Auth failed: {reason}", this.lp({reason: this.reason || "No reason given"}));
        if (this.id != this.core.settings.Vega.id) this.core.settings.Vega.id = this.id;
        this.log("Connected to vega as {id}", this.lp({id: this.id, consoleColor: 2}));
        this.core.vega.send(new RequestServers(this.main))
        this.core.vega.apiKey = this.key;
        this.core.vega.connected = true;
        this.core.vega.port = this.port;
    }
}

module.exports = auth;