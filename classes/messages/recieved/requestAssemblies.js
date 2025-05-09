var message = require('../../message');


class requestAssemblies extends message {

    requestId;

    /** @type Array<import("../../classes/assembly")> */
    assemblies;

    error;

    constructor(main, data) {
        super(main);
        this.requestId = data.requestId;
        this.assemblies = data.assemblies;
        this.error = data.error;
    }

    handle () {
        if (this.main.requests.has(this.requestId)) {
            const request = this.main.requests.get(this.requestId);
            this.main.requests.delete(this.requestId);
            if (this.error != null) return request.reject(new Error(this.error));
            request.resolve(this.assemblies);
        }
    }
}

module.exports = requestAssemblies;