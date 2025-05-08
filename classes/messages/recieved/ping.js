var message = require('../../message');
var pong = require('../templates/pong.js');

class ping extends message {
    constructor(main, data) {
        super(main);
    }

    handle () {
        this.main.send(new pong(this.main));
    }
}

module.exports = ping;