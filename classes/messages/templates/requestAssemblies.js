const message = require('../../message');

class requestAssemblies extends message {
    label;

    requestId;

    assemblies;

    constructor(main, label, assemblies, requestId) {
        super(main);
        this.label = label;
        this.requestId = requestId;
        this.assemblies = assemblies;
    }
}

module.exports = requestAssemblies;
