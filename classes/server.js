const StandardIOHandler = require('./standardIOHandler.js');

class Server {
    constructor() {
        this.ioHandler = new StandardIOHandler(this);
    }

    toJSON () {
        return {};
    }
}

module.exports = Server;