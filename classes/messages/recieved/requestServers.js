var message = require('../../message');
const fs = require('fs');
const path = require('path');
const ServerConfig = require('../../serverConfig.js');
const Server = require('../../server.js');

class requestServers extends message {

    servers;

    constructor(main, data) {
        super(main);
        this.servers = data.servers;
    }

    handle () {
        //Go through all servers in memory and remove anything that doesn't belong using uninstall()
        this.core.servers.forEach(s => {
            if (!this.servers.find(temp => s.id === temp.id)) s.uninstall();
        });

        //Add servers from config
        this.servers.forEach(server => {
            //Create server
            if (!this.core.servers.has(server.id)) new Server(this.core, server);
            //Update the server config if it already exists
            else {
                let s = this.core.servers.get(server.id);
                s.config.update(server);
                if (!s.configured) s.configure();
            }
        });

        //Go though the servers folder and remove unclaimed folders
        fs.readdirSync(this.core.settings.serversFolder).forEach(folder => {
            if (!this.core.servers.has(folder)) {
                const folderPath = path.join(this.core.settings.serversFolder, folder);
                fs.rmSync(folderPath, { recursive: true, force: true });
            }
        });
    }
}

module.exports = requestServers;