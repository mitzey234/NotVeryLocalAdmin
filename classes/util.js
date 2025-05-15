const crypto = require("crypto");
const EventEmitter = require("events");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

function s(x, y) {
    var pre = ['string', 'number', 'bool']
    if (typeof x !== typeof y) return pre.indexOf(typeof y) - pre.indexOf(typeof x);

    if (x === y) return 0;
    else return (x > y) ? 1 : -1;
}

function equals(a, b) {
    if (!a || !b) return false;
    if (a.length != b.length) return false;
    for (var i = 0, l = a.length; i < l; i++) {
        if (a[i] instanceof Array && b[i] instanceof Array) {
            if (!equals(b[i], a[i])) return false;
        } else if (a[i] != b[i]) {
            return false;
        }
    }
    return true;
}

/** BE CAREFUL WITH THIS FUNCTION, It will process any Null values as valid properties that can be modified
 * @param {*} value 
 * @param {Array<string>} path 
 * @param {Function} emit 
 */
function processObjectProp(setting, path, emit) {
    if (setting instanceof Map) {
        setting.forEach((value, key) => processObjectProp.bind(setting)(value, path.concat(key), emit));
        if (setting["toObject"] == null) {
            setting["toObject"] = function () {
                let o = {};
                for (let i of this) o[i[0]] = i[1].toObject(this);
                return o;
            };
        }
    } else if (typeof setting === "object" && !Array.isArray(setting) && setting !== null) {
        for (let i in setting) processObjectProp.bind(setting)(setting[i], path.concat(i), emit);
        let method = function () {
            let o = {};
            for (let i in this) {
                if (i.startsWith("_")) o[i.substring(1)] = setting[i];
                else if (setting[i] != null && typeof setting[i] === "object" && !Array.isArray(setting[i]) && setting[i].toObject != null && typeof setting[i].toObject == "function") o[i] = setting[i].toObject(setting);
            }
            return o;
        };
        if (setting["toObject"] == null) setting["toObject"] = method;
        else setting["toObjectSuper"] = method;
    } else if (typeof setting === "string" || typeof setting === "number" || typeof setting === "boolean" || setting === null) {
        let trueName = path[path.length - 1];
        let falseName = "_" + trueName;
        this[falseName] = setting;
        Object.defineProperty(this, trueName, {
            get: function () {
                emit("get", { path: path.join("."), value: this[falseName] });
                return this[falseName];
            }.bind(this),
            set: function (newValue) {
                let old = this[falseName];
                this[falseName] = newValue;
                emit("set", { path: path.join("."), value: newValue, old });
            }.bind(this)
        });
    } else if (setting != null && Array.isArray(setting)) {
        let trueName = path[path.length - 1];
        let falseName = "_" + trueName;
        this[falseName] = setting;
        this[trueName] = new Proxy(this[falseName], {
            deleteProperty: function (target, property) {
                let old = [...target];
                target.splice(parseInt(property), 1);
                emit("set", { path: path.join("."), value: target, old });
                return true;
            },
            get: function (target, prop) {
                if ((typeof prop == "string" || typeof prop == "number") && !isNaN(parseInt(prop))) {
                    let p = path.concat(parseInt(prop));
                    emit("get", { path: p.join("."), value: this[falseName] });
                    return target[prop];
                }
                if (prop == "push") {
                    return function (value) {
                        let old = [...this[falseName]];
                        this[falseName].push(value);
                        emit("set", { path: path.join("."), value: this[falseName], old });
                    }.bind(this);
                } else return target[prop];
            }.bind(this),
            set: function (target, prop, value) {
                if (!isNaN(parseInt(prop))) {
                    let old = [...this[falseName]];
                    this[falseName][prop] = value;
                    emit("set", { path: path.join("."), value: this[falseName], old });
                    return true;
                }
                this[falseName][prop] = value;
                return true;
            }.bind(this)
        });
    }
}

function processObjectShallow(obj) {
    for (let key in obj) {
        processObjectProp.bind(obj)(obj[key], [key], obj.emit.bind(obj));
    }
}

/**
 * Creates a new object with all properties of the provided object
 * but none of the properties that cannot be translated to JSON, such as functions.
 * @param {object} obj - The object to be filtered.
 * @returns {object} - A new object with only JSON-serializable properties.
 */
function filterSerializableProperties(obj, ...skip) {
    const result = {};
    for (const key in obj) {
        const value = obj[key];
        if (typeof value !== 'function' && !key.startsWith("_") && !skip.includes(key)) {
            if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof SetEmitter) && value !== null) {
                result[key] = filterSerializableProperties(value); // Recursively filter nested objects
            } else {
                result[key] = value;
            }
        } else if (value instanceof SetEmitter) {
            result[key] = value.toJSON();
        }
    }
    return result;
}

function Delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function len(obj) {
    return Object.keys(obj).length;
}

function generateId() {
    return crypto.randomBytes(8).toString("hex");
}

function md5(path) {
    return crypto.createHash('md5').update(fs.readFileSync(path)).digest('hex');
}
function cleanInput(args) {
    args = args.trim();
    args = args.split(" ");
    var temp = {};
    for (let i in args) temp[i] = args[i].trim();
    args = [];
    for (let i in temp) if (temp[i] != "") args.push(temp[i]);
    return args
}

function runCommand(command) {
    return new Promise(function (resolve) {
        let run = exec(command);
        run.on("close", resolve);
    }.bind(command));
}

function convertToMask(cpus) {
    if (typeof cpus == "object" && Array.isArray(cpus)) {
        let sum = 0;
        for (let i in cpus) sum += Math.pow(2, cpus[i]);
        return sum.toString(16);
    } else if (typeof cpus == "number") {
        return Math.pow(2, cpus).toString(16);
    } else {
        throw "Unsupported type:" + typeof cpus;
    }
}

class SetEmitter extends Set {

    /**
     * @param {EventEmitter} source 
     * @param  {...any} args 
     */
    constructor(source, ...args) {
        super(...args);
        this.source = source;
    }

    /**
     * Adds a new element to the CustomSet.
     * @param {*} value - The value to add to the set.
     * @returns {SetEmitter} - The CustomSet object.
     */
    add(value) {
        if (super.has(value)) return this;
        super.add(value);
        this.source.emit("add", value);
        return this;
    }

    /**
     * Removes an element from the CustomSet.
     * @param {*} value - The value to remove from the set.
     * @returns {boolean} - True if the value was successfully removed, false otherwise.
     */
    delete(value) {
        if (!super.has(value)) return false;
        super.delete(value);
        this.source.emit("delete", value);
        return true;
    }

    /**
     * Clears all elements from the CustomSet.
     */
    clear() {
        this.forEach(value => this.delete(value));
    }

    toJSON() {
        return Array.from(this);
    }
}

function toInt32(int) {
    int = int.toString(16);
    while (int.length < 8) int = "0" + int;
    var arr = [];
    for (let i = 0; i < int.length / 2; i++) arr[i] = int[i * 2] + int[i * 2 + 1];
    var arr2 = [];
    for (let i = 0; i < arr.length; i++) arr2[i] = arr[arr.length - i - 1];
    return Buffer.from(arr2.join(""), "hex");
}

/**
 * @param {string[]} array 
 */
function convertToPath(array) {
    let p = "";
    array.forEach((item, index) => {
        if (index == 0) p = item;
        else p = path.join(p, item);
    });
    return p;
}

function formatBytes(bytes) {
    if (bytes < 1000) return bytes + " B";
    else if (bytes < 1000000) return (bytes / 1000).toFixed(2) + " KB";
    else if (bytes < 1000000000) return (bytes / 1000000).toFixed(2) + " MB";
    else if (bytes < 1000000000000) return (bytes / 1000000000).toFixed(2) + " GB";
    else return (bytes / 1000000000000).toFixed(2) + " TB";
}

/**
 * @param {string | Array<string>} path 
 * @param {object} obj 
 * @param {object} value 
 */
function setProperty(path, obj, value) {
    if (typeof path == "string") path = path.split(".");
    let data = obj;
    for (let i = 0; i < path.length; i++) {
        if (i == path.length - 1) {
            if (typeof value == "object" && value != null && !Array.isArray(value)) {
                if (data[path[i]] == null) data[path[i]] = {};
                for (let x in value) {
                    if (value[x] == null) continue;
                    data[path[i]][x] = value[x];
                }
            } else if (Array.isArray(value) && Array.isArray(data[path[i]])) {
                if (value.length > data[path[i]].length) {
                    //We are adding to the array
                    data[path[i]].push(...value.filter(x => !data[path[i]].includes(x)));
                } else if (value.length < data[path[i]].length) {
                    //We are removing from the array
                    for (let x = data[path[i]].length - 1; x >= 0; x--) {
                        if (!value.includes(data[path[i]][x])) {
                            delete data[path[i]][x];
                        }
                    }
                }
            } else if (!Array.isArray(data[path[i]])) data[path[i]] = value;
            return;
        }
        if (data[path[i]] == null) data[path[i]] = {};
        data = data[path[i]];
    }
    return;
}

module.exports.s = s;
module.exports.equals = equals;
module.exports.processObjectProp = processObjectProp;
module.exports.processObjectShallow = processObjectShallow;
module.exports.filterSerializableProperties = filterSerializableProperties;
module.exports.Delay = Delay;
module.exports.len = len;
module.exports.generateId = generateId;
module.exports.cleanInput = cleanInput;
module.exports.runCommand = runCommand;
module.exports.convertToMask = convertToMask;
module.exports.SetEmitter = SetEmitter;
module.exports.toInt32 = toInt32;
module.exports.convertToPath = convertToPath;
module.exports.formatBytes = formatBytes;
module.exports.md5 = md5;
module.exports.setProperty = setProperty;