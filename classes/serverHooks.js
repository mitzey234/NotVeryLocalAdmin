module.exports = class ServerHooks {
    /** @type {Array<{resolve: Function, reject: Function}>} */
    shutdown = [];

    /** @type {Array<{resolve: Function, reject: Function}>} */
    start = [];

    /** @type {Array<{resolve: Function, reject: Function}>} */
    restart = [];

    /**
     * @param {import("./server")} main 
     */
    constructor (main) {
        this.main = main;
    }

    resolve (hookName, value) {
        if (this[hookName] == null) return this.main.warn(`Hook ${hookName} does not exist`);
        if (this[hookName].length > 0) {
            this[hookName].forEach(hook => {
                hook.resolve(value);
            });
            this[hookName] = [];
        } else {
            this.main.verbose(`No hooks to resolve for ${hookName}`);
        }
    }

    reject (hookName, e) {
        if (this[hookName].length > 0) {
            this[hookName].forEach(hook => {
                hook.reject(e);
            });
            this[hookName] = [];
        } else {
            this.main.verbose(`No hooks to reject for ${hookName}`);
        }
    }

    promise (hookName) {
        return new Promise((resolve, reject) => {
            this[hookName].push({resolve, reject});
        });
    }
}