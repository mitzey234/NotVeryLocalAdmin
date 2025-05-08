var message = require('../../message');

class File {
    /** @type string */
    name;

    /** @type string */
    extension;

    /** @type number */
    lastModified;

    /** @type number */
    created;

    /** @type number */
    size;

    /** @type Array<string> */
    path;

    /** @type string */
    md5;

    /** @type object */
    properties;

    /** @type boolean */
    global;
}

class requestFiles extends message {
    requestId;

    /** @type Array<File> */
    files;

    error;

    constructor(main, data) {
        super(main);
        this.requestId = data.requestId;
        this.files = data.files;
        this.error = data.error;
    }

    handle () {
        if (this.main.requests.has(this.requestId)) {
            const request = this.main.requests.get(this.requestId);
            this.main.requests.delete(this.requestId);
            if (this.error != null) return request.reject(new Error(this.error));
            request.resolve(this.files);
        }
    }
}

module.exports = requestFiles;