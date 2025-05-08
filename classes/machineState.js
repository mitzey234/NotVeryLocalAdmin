const EventEmitter = require('events');
const Util = require('./util');

class MachineState extends EventEmitter {
    uptime = Date.now();
  
    cpu = 0;

    systemCPU = 0;
    
    label = "";

    lowMemory = false;

    totalMemory = -1;

    memory = -1;
  
    constructor() {
        super();
        Util.processObjectShallow(this);
    }
  
    toObject () {
        return Util.filterSerializableProperties(this);
    }
}

module.exports = MachineState;