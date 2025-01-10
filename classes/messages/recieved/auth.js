var message = require('../../message');

class auth extends message {
    id;

    pass;

    reason;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.pass = data.pass;
        this.reason = data.reason;
    }

    handle () {
        if (this.pass == false) return this.error("Auth failed: {reason}", this.lp({reason: this.reason || "No reason given"}));
        if (this.id != this.core.settings.Vega.id) this.core.settings.Vega.id = this.id;
        this.log("Connected to vega as {id}", this.lp({id: this.id, consoleColor: 2}));
    }
}

module.exports = auth;