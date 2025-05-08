const crypto = require("crypto");
const EventEmitter = require("events");
const { exec } = require("child_process");

function s(x,y){
    var pre = ['string' , 'number' , 'bool']
    if(typeof x!== typeof y )return pre.indexOf(typeof y) - pre.indexOf(typeof x);

    if(x === y)return 0;
    else return (x > y)?1:-1;
}

function equals (a, b) {
    if (!a || !b) return false;
    if (a.length != b.length) return false;
    for (var i = 0, l=a.length; i < l; i++) {
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
function processObjectProp (value, path, emit) {
    if (path.join(".") == "_eventsCount") return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      let trueName = path[path.length-1];
      let falseName = "_"+trueName;
      this[falseName] = value;
      Object.defineProperty(this, trueName, {
        get: function () {
          emit("get", {path: path.join("."), value: this[falseName]});
          return this[falseName];
        }.bind(this),
        set: function (newValue) {
          let old = this[falseName];
          this[falseName] = newValue;
          emit("set", {path: path.join("."), value: newValue, old});
        }.bind(this)
      });
    }
}

function processObjectShallow (obj) {
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
            if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof SetEmitter)  && value !== null) {
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

function Delay (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function len (obj) {
    return Object.keys(obj).length;
}

function generateId () {
    return crypto.randomBytes(8).toString("hex");
}

function cleanInput (args) {
    args = args.trim();
    args = args.split(" ");
    var temp = {};
    for (let i in args) temp[i] = args[i].trim();
    args = [];
    for (let i in temp) if (temp[i] != "") args.push(temp[i]);
    return args
}

function runCommand (command) {
    return new Promise(function (resolve) {
        let run = exec(command);
        run.on("close", resolve);
    }.bind(command));
}

function convertToMask (cpus) {
    if (typeof cpus == "object" && Array.isArray(cpus)) {
        let sum = 0;
        for (let i in cpus) sum += Math.pow(2,cpus[i]);
        return sum.toString(16);
    } else if (typeof cpus == "number") {
        return Math.pow(2,cpus).toString(16);
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

function toInt32 (int) {
    int = int.toString(16);
    while (int.length < 8) int = "0"+int;
    var arr = [];
    for (let i = 0; i<int.length/2; i++) arr[i] = int[i*2] + int[i*2+1];
    var arr2 = [];
    for (let i = 0; i<arr.length; i++) arr2[i] = arr[arr.length-i-1];
    return Buffer.from(arr2.join(""), "hex");
}

function formatBytes(bytes) {
    if (bytes < 1000) return bytes + " B";
    else if (bytes < 1000000) return (bytes / 1000).toFixed(2) + " KB";
    else if (bytes < 1000000000) return (bytes / 1000000).toFixed(2) + " MB";
    else if (bytes < 1000000000000) return (bytes / 1000000000).toFixed(2) + " GB";
    else return (bytes / 1000000000000).toFixed(2) + " TB";
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
module.exports.formatBytes = formatBytes;