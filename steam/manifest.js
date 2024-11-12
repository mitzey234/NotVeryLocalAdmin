class Chunk {
    /** @type string */
    sha;

    /** @type number */
    crc;

    /** @type string */
    offset;

    /** @type number */
    cb_original;

    /** @type number */
    cb_compressed;

    constructor(obj) {
        for (let i in obj) this[i] = obj[i];
    }
}

class File {
    /** @type Array<Chunk> */
    chunks;

    /** @type string */
    filename;

    /** @type string */
    size;

    /** @type number */
    flags;

    /** @type string */
    sha_filename;

    /** @type string */
    sha_content;

    /** @type Object */
    linktarget;

    constructor(obj) {
        for (let i in obj) {
            if (i == "chunks") {
                this.chunks = [];
                for (let j in obj[i]) this.chunks.push(new Chunk(obj[i][j]));
                continue;
            } else this[i] = obj[i];
        }
    }
}

class Manifest {
    /** @type string */
    app_id;

    /** @type number */
    depot_id;

    /** @type string */
    gid_manifest;

    /** @type number */
    creation_time;

    /** @type boolean */
    filenames_encrypted;

    /** @type string */
    cb_disk_original;

    /** @type string */
    cb_disk_compressed;

    /** @type number */
    unique_chunks;

    /** @type number */
    crc_encrypted;

    /** @type number */
    crc_clear;

    /** @type Array<File> */
    files = [];

    constructor(obj) {
        for (let i in obj) {
            if (i == "files") {
                this.files = [];
                for (let j in obj[i]) this.files.push(new File(obj[i][j]));
                this.files.sort((a, b) => b.size - a.size);
                continue;
            } else this[i] = obj[i];
        }
    }
}

module.exports = { Manifest, File, Chunk };