const message = require('../../message');

class serverConsoleLog extends message {
    /** @type string */
    serverId;

    /** @type string */
    log;

    /** @type number */
    color;

    /** @type number */
    stamp;

    constructor(main, serverId, log, color, stamp) {
        super(main);
        this.serverId = serverId;
        this.log = log;
        this.color = color;
        this.stamp = stamp;
    }
}

module.exports = serverConsoleLog;