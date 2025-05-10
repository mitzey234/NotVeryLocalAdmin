const message = require('../../message');

class machineOnStateUpdate extends message {

    data;

    constructor(main, data) {
        super(main);
        this.data = data;
    }
}

module.exports = machineOnStateUpdate;