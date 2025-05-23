var message = require('../../message');

class sendCommand extends message {
    id;

    command;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.command = data.command;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                this.core.log(`Web sending command to server {serverName}: {command}`, this.core.lp({serverName: this.id, command: this.command}));
                server.command(this.command);
            } catch (e) {
                this.core.error(`Error sending command to server {sid}: ${e}`, this.core.lp({sid: this.id, e: e?.code || e?.message || e, stack: e?.stack, command: this.command}));
            }
        }
    }
}

module.exports = sendCommand;