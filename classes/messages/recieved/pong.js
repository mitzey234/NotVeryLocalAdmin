var message = require('../../message');

class pong extends message {
    constructor(main) {
        super(main);
    }

    handle () {
        this.main.pingSystem.resolve();
    }
}

module.exports = pong;