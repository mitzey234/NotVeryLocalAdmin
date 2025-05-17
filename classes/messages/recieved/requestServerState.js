var message = require('../../message');
const RequestServerState = require('../templates/requestServerState');

class requestServerState extends message {
    id;
    
    constructor(main, data) {
        super(main);
        this.id = data.id;
    }

    handle () {
        let server = this.core.servers.get(this.id);
        if (server != null) {
            this.main.send(new RequestServerState(this.main, server));
        }
    }
}

module.exports = requestServerState;