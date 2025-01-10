const crypto = require("crypto");


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
            if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
                result[key] = filterSerializableProperties(value); // Recursively filter nested objects
            } else {
                result[key] = value;
            }
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

module.exports.s = s;
module.exports.equals = equals;
module.exports.processObjectProp = processObjectProp;
module.exports.processObjectShallow = processObjectShallow;
module.exports.filterSerializableProperties = filterSerializableProperties;
module.exports.Delay = Delay;
module.exports.len = len;
module.exports.generateId = generateId;
module.exports.cleanInput = cleanInput;