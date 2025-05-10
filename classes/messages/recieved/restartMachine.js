var message = require('../../message');

class restartMachine extends message {
    constructor(main) {
        super(main);
    }

    handle () {
        this.core.restart();
    }
}

module.exports = restartMachine;