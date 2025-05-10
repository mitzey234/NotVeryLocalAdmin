const message = require('../../message');

class getConfig extends message {

    id;

    config;

    constructor(main, id) {
        super(main);
        this.id = id;
        this.config = this.core.settings.simplify();
        this.config.verkey = this.core.verkey;
    }
}

module.exports = getConfig;