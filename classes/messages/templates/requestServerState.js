const message = require('../../message');

class requestServerState extends message {

    id;

    states;

    /**
     * @param {*} main 
     * @param {import("../../server")} server 
     */
    constructor(main, server) {
        super(main);
        this.id = server.id;
        this.states = server.state.toObject();
    }
}

module.exports = requestServerState;