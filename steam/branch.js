class Branch {
    /** @type string */
    name;

    /** @type string */
    buildid;

    /** @type boolean */
    pwdrequired = false;

    /** Ex: 1730666878 
     * @type number */
    timeupdated;

    /** @type string */
    description;

    constructor (obj, name) {
        this.name = name;
        for (let i in obj) {
            if (i == "pwdrequired") {
                this.pwdrequired = obj[i] == '1';
            } else if (i == "timeupdated") {
                this.timeupdated = parseInt(obj[i]);
            } else this[i] = obj[i];
        }
    }
}

module.exports = Branch;