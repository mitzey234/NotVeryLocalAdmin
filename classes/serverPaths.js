const path = require("path");

class ServerPaths {
    /** @type {import("./server")} */
    server;

    get config () {
      return this.server.config;
    }

    get core () {
      return this.server.main;
    }
  
    /** @param {import("./server")} c */
    constructor (s) {
      this.server = s;
    }

    get port () {
      return this.config.port.toString();
    }
  
    get serverContainer () {
      return path.join(path.resolve(this.core.settings.serversFolder), this.config.id);
    }
  
    get appdata () {
      return path.join(this.serverContainer, "AppData");
    }

    get gameAppDataFolder () {
      return path.join(this.appdata, "SCP Secret Laboratory");
    }

    get apiFolderPath () {
      return path.join(this.gameAppDataFolder, this.config.appDataFolderName.replaceAll("$PORT", this.port));
    }
  
    get pluginsFolderPath () {
      return path.join(this.apiFolderPath, this.config.pluginsFolderPath.replaceAll("$PORT", this.port));
    }

    get pluginConfigsFolderPath () {
      return path.join(this.apiFolderPath, this.config.configsFolderPath.replaceAll("$PORT", this.port));
    }

    get dependanciesFolderPath () {
      return path.join(this.apiFolderPath, this.config.dependanciesFolderPath.replaceAll("$PORT", this.port));
    }
  
    get serverConfigsFolder () {
      return path.join(this.appdata, "config", this.port);
    }
  
    get globalDedicatedServerConfigFiles () {
      return path.join(this.appdata, "config", "global");
    }
  
    get serverCustomAssembliesFolder () {
      return path.join(this.serverContainer, "SCPSL_Data", "Managed");
    }
}

module.exports = ServerPaths;