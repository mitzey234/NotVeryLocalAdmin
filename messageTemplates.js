class pong {
    /* @type {string} */
    type;

    constructor(main, obj) {
        this.type = this.prototype.constructor.name;
    }
}

module.exports = {
    pong: pong
}