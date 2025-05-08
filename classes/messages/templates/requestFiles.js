const message = require('../../message');

class requestFiles extends message {
    serverId;

    label;

    requestId;

    constructor(main, serverId, label, requestId) {
        super(main);
        this.serverId = serverId;
        this.label = label;
        this.requestId = requestId;
    }
}

module.exports = requestFiles;