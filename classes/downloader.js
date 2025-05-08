module.exports = class Downloader {
    /** @type import("./server") */
    main;

    queue = [];



    constructor(main) {
        this.main = main;
        
    }

    downloadFile(label, server, path)

    cancelAll () {

    }
}