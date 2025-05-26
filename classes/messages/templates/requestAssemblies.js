const message = require('../../message');

class requestAssemblies extends message {
    label;

    requestId;

    serverId;

    constructor(main, label, serverId, requestId) {
        super(main);
        this.label = label;
        this.requestId = requestId;
        this.serverId = serverId;
    }
}

module.exports = requestAssemblies;
