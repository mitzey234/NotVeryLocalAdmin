var message = require('../../message');

class stopMachine extends message {
    constructor(main) {
        super(main);
    }

    handle () {
        this.core.log('Web Stopping machine...');
        this.core.stop();
    }
}

module.exports = stopMachine;