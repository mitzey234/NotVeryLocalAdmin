const message = require('../../message');

class serverOnStateUpdate extends message {

    id;

    data;

    constructor(main, id, data) {
        super(main);
        this.id = id;
        this.data = data;
    }
}

module.exports = serverOnStateUpdate;