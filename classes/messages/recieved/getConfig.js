var message = require('../../message');
var GetConfig = require('../templates/getConfig');

class getConfig extends message {

    id;

    constructor(main, data) {
        super(main);
        this.id = data.id;
    }

    handle () {
        this.core.vega.send(new GetConfig(this.main, this.id));
    }
}

module.exports = getConfig;