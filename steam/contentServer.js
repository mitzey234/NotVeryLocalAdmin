class ContentServer {
    /** @type string */
    type;

    /** @type string */
    sourceid;

    /** @type string */
    cell;

    /** @type string */
    load;

    /** @type string */
    weightedload;

    /** @type string */
    NumEntriesInClientList;

    /** @type string */
    Host;

    /** @type string */
    vhost;

    /** @type string */
    https_support;

    constructor (obj) {
        for (let i in obj) this[i] = obj[i];
    }
}

module.exports = ContentServer;