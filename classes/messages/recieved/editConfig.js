var message = require('../../message');

class editConfig extends message {
    path;

    value;

    constructor(main, data) {
        super(main);
        this.path = data.path;
        this.value = data.value;
    }

    handle () {
        if (Array.isArray(this.path) && this.path.length == 1 && this.path[0] == "verkey") return this.main.main.verkey = this.value;

        let target = this.main.main.settings;
        for (let i = 0; i < this.path.length - 1; i++) {
            if (target === undefined) continue;
            target = target[this.path[i]];
        }
        if (target === undefined) {
            this.error("Invalid path was used to edit setting: {path}", this.lp({path: this.path}));
        } else {
            if (Array.isArray(this.value) && Array.isArray(target[this.path[this.path.length - 1]])) {
                target[this.path[this.path.length - 1]].splice(0, target[this.path[this.path.length - 1]].length);
                for (let i in this.value) target[this.path[this.path.length - 1]].push(this.value[i]);
            } else {
                target[this.path[this.path.length - 1]] = this.value;
            }
        }
    }
}

module.exports = editConfig;