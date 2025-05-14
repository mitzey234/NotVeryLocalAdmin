var message = require('../../message');

class assemblyEvent extends message {
    id;

    event;

    label;

    assembly;

    constructor(main, data) {
        super(main);
        this.id = data.id;
        this.event = data.event;
        this.label = data.label;
        this.assembly = data.assembly;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server) {
            try {
                server.assemblyEvent(this.event, this.label, this.assembly);
            } catch (e) {
                this.core.error(`Error handling {aLabel} assembly event {sid}: ${e}`, this.core.lp({sid: this.id, aLabel: this.label, e: e?.code || e?.message || e, stack: e?.stack, event: this.event, assembly: this.assembly}));
            }
        }
    }
}

module.exports = assemblyEvent;