class SteamSettings {
    /** How many workers should be dispatched for the file queue */
    fileWorkers = 6;

    /** How many file decoding workers should be dispatched per file */
    decodeWorkers = 12;

    concurrentDownloads = 12;
}

module.exports = SteamSettings;