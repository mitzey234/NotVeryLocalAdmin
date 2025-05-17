const message = require('../../message');

class transferStateUpdate extends message {
    id;

    data;

    constructor(main, id, data) {
        super(main);
        this.id = id;
        this.data = data;
    }
}

module.exports = transferStateUpdate;