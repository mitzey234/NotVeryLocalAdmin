const message = require('../../message');
const os = require('os');

class echoPort extends message {
    port;

    addresses;

    constructor(main, port) {
        super(main);
        this.port = port;
        if (this.port != null) {
            const nets = os.networkInterfaces();
            this.addresses = [];
            for (let i in nets) {
                let intf = nets[i];
                for (let x in intf) {
                    let net = intf[x];
                    const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
                    if (net.family === familyV4Value && !net.internal && !this.addresses.includes(net.address)) this.addresses.push(net.address);
                }
            }
        } else this.addresses = null;
    }
}

module.exports = echoPort;