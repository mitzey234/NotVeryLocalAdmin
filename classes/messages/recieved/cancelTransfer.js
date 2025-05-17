var message = require('../../message');

class cancelTransfer extends message {

    id;

    reason;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.reason = data.reason;
    }

    handle () {
        let transfer = this.core.activeTransfers.get(this.id);
        if (transfer == null) return;
        transfer.cancel(this.reason);
    }
}

module.exports = cancelTransfer;