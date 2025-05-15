const message = require('../../message');

class verkeyUpdate extends message {

    key;

    constructor(main, key) {
        super(main);
        this.key = key;
    }
}

module.exports = verkeyUpdate;