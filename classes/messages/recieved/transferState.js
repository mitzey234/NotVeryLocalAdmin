var message = require('../../message');

class transferState extends message {
    id; 

    value;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.value = data.value;
    }

    handle () {
        var transfer = this.core.activeTransfers.get(this.id);
        if (transfer == null) return;
        transfer._state = this.value;
        if (transfer.state == "Waiting" && transfer.direction == "source") {
            transfer.targetReady();
        } else if (transfer.state == "Ready" && transfer.direction == "target") {
            transfer.sourceReady();
        }
    }
}

module.exports = transferState;