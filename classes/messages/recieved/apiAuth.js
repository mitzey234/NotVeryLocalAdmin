var message = require('../../message');

class apiAuth extends message {

    key;

    constructor(main, data) {
        super(main);
        this.key = data.key;
    }

    handle () {
        this.core.vega.apiKey = this.key;
    }
}

module.exports = apiAuth;