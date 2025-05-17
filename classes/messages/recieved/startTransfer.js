var message = require('../../message');
const ServerTransfer = require('../../serverTransfer');

class startTransfer extends message {

    id;

    direction;

    config;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.direction = data.direction;
        this.config = data.config;
    }

    handle () {
        if (this.core.activeTransfers.has(this.id)) return;
        new ServerTransfer(this.config, this.core, this.direction);
    }
}

module.exports = startTransfer;