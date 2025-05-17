var message = require('../../message');
const ServerTransfer = require('../../serverTransfer');

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
        transfer.cancel()
        new ServerTransfer(this.config, this.core, this.direction);
    }
}

module.exports = cancelTransfer;