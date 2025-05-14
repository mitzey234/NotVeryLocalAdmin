var message = require('../../message');

class fileEvent extends message {
    id;

    event;

    folderLabel;

    file;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.event = data.event;
        this.folderLabel = data.folderLabel;
        this.file = data.file;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                server.fileEvent(this.event, this.folderLabel, this.file);
            } catch (e) {
                this.core.error(`Error handling {flabel} file event {sid}: ${e}`, this.core.lp({sid: this.id, flabel: this.folderLabel, e: e?.code || e?.message || e, stack: e?.stack, event: this.event, file: this.file}));
            }
        }
    }
}

module.exports = fileEvent;