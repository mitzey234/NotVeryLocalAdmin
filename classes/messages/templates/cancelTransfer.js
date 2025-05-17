const message = require('../../message');

class cancelTransfer extends message {

    id;

    reason;

    constructor(main, id, reason) {
        super(main);
        this.id = id;
        this.reason = reason;
    }
}

module.exports = cancelTransfer;