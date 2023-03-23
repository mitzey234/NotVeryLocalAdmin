module.exports = class pingSystem {
    /** @type function */
    sendMethod = null;

    /** @type function */
    pingHostDeathMethod = null;

    /** @type number */
    failures = 0;

    /** @type boolean */
    inProgress = false;

    /** @type number */
    timeout;

    /** @type number */
    interval;

    constructor (send, death) {
        this.sendMethod = send;
        this.pingHostDeathMethod = death;
        this.interval = setInterval(this.send.bind(this), 1000);
        this.send.bind(this)();
    }

    send () {
        if (this.inProgress) return;
        this.inProgress = true;
        this.sendMethod({type: "ping"});
        this.timeout = setTimeout(this.timeoutMethod.bind(this), 5000);
    }

    timeoutMethod () {
        this.failures++;
        if (this.failures >= 3) {
            this.pingHostDeathMethod();
            clearInterval(this.interval);
        }
        this.inProgress = false;
    }

    resolve () {
        clearTimeout(this.timeout);
        this.inProgress = false;
        this.failures = 0;
    }

    destroy () {
        clearInterval(this.interval);
        clearTimeout(this.timeout);
    }
}
