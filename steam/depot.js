class Config {
    /** Comma separated list of OS's this depot covers */
    oslist;

    /** The CPU architecture the depot covers */
    osarch;

    constructor (obj) {
        for (let i in obj) this[i] = obj[i];
    }
}

class Manifest {
    /** @type string */
    download;
    
    /** The unique identifier of this manifest
     * @type string */
    gid;

    /** The size of the manifest
     * @type string */
    size;

    constructor (obj) {
        for (let i in obj) this[i] = obj[i];
    }
}

class Depot {
    /** @type Map<string, Manifest> */
    manifests;

    /** @type Map<string, Manifest> */
    encryptedmanifests;

    /** This indicates that this depot belongs to another app
     * @type string */
    depotfromapp;

    constructor (obj) {
        for (let i in obj) {
            if (i == "manifests") {
                this.manifests = new Map();
                for (let j in obj[i]) this.manifests.set(j, new Manifest(obj[i][j]));
                continue;
            } else if (i == "encryptedmanifests") {
                this.encryptedmanifests = new Map();
                for (let j in obj[i]) this.encryptedmanifests.set(j, new Manifest(obj[i][j]));
                continue;
            } else if (i == "config") {
                this.config = new Config(obj[i]);
                continue;
            } else this[i] = obj[i];
        }
    }
}

module.exports = Depot;