const util = require("./util.js");
const path = require("path");
const fs = require("fs");

module.exports = class SettingChangeHandler {
    /** @type {import("./server.js")} */
    Main;
  
    /** This is a variable for disabling the settings change handler in case you want to make changes that don't trigger event code */
    disabled = false;
  
    /** @type {Map<string, Function>} */
    functionMaps = new Map();
  
    constructor(main) {
      this.Main = main;
      this.Main.config.on('set', this.handleSettingChange.bind(this));
  
      this.functionMaps.set("assignedMachine", this.handleMachineChange.bind(this));
      this.functionMaps.set("plugins", this.handleAssemblyChange.bind(this, "plugins"));
      this.functionMaps.set("customAssemblies", this.handleAssemblyChange.bind(this, "customAssemblies"));
      this.functionMaps.set("dependancies", this.handleAssemblyChange.bind(this, "dependencies"));
      this.functionMaps.set("appDataFolderName", this.handleAppDataFolderChange.bind(this));
      this.functionMaps.set("pluginsFolderPath", this.handlePluginsFolderChange.bind(this));
      this.functionMaps.set("dependanciesFolderPath", this.handleDependenciesFolderChange.bind(this));
      this.functionMaps.set("configsFolderPath", this.handlePluginConfigFolderChange.bind(this));
      this.functionMaps.set("port", this.handlePortChange.bind(this));
    }
  
    /**
     * @param {{path: string, value: *, old: *}} data 
     */
    handleSettingChange(data) {
      if (this.disabled) return;
      if (!Array.isArray(data.value) && !Array.isArray(data.old) && data.value == data.old) return;
      if (Array.isArray(data.value) && Array.isArray(data.old)) {
        data.value.sort(util.s);
        data.old.sort(util.s);
        if (util.equals(data.value, data.old)) return;
      }
      
      if (this.functionMaps.has(data.path)) this.functionMaps.get(data.path)(data.value, data.old, data.path);
    }

    async handleMachineChange (value) {
      if (value == this.Main.main.settings.Vega.id) return;
      await this.Main.uninstall();
    }

    async handleAssemblyChange (label, value, old) {
      if (value.length > old.length) {
        //We are installing a plugin
        let plugin = value.filter(x => !old.includes(x))[0];
        this.Main.log(`Installing {alabel} assembly {plugin}`, this.Main.main.lp({alabel: label, plugin}));
        let folder;
        if (label == "plugins") folder = this.Main.paths.pluginsFolderPath;
        else if (label == "customAssemblies") folder = this.Main.paths.serverCustomAssembliesFolder;
        else if (label == "dependencies") folder = this.Main.paths.dependanciesFolderPath;
        else return;
        let fsPath = path.join(folder, plugin + ".dll");
        if (fs.existsSync(fsPath)) {
          try {
            fs.rmSync(fsPath, { recursive: true, force: true });
          } catch (e) {
            this.Main.log(`Error removing file {path}: {e}`, this.Main.lp({path: fsPath, e: e?.code || e?.message || e, stack: e?.stack}));
          }
        }
        this.Main.downloader.downloadAssembly(label, plugin, fsPath);
      }
      else if (value.length < old.length) {
        //We are removing a plugin
        let plugin = old.filter(x => !value.includes(x))[0];
        this.Main.log(`Removing {alabel} assembly {plugin}`, this.Main.main.lp({alabel: label, plugin}));
        let folder;
        if (label == "plugins") folder = this.Main.paths.pluginsFolderPath;
        else if (label == "customAssemblies") folder = this.Main.paths.serverCustomAssembliesFolder;
        else if (label == "dependencies") folder = this.Main.paths.dependanciesFolderPath;
        else return;
        let fsPath = path.join(folder, plugin + ".dll");
        if (fs.existsSync(fsPath)) {
          try {
            fs.rmSync(fsPath, { recursive: true, force: true });
          } catch (e) {
            this.Main.log(`Error removing file {path}: {e}`, this.Main.lp({path: fsPath, e: e?.code || e?.message || e, stack: e?.stack}));
          }
        }
      }
    }

    handleAppDataFolderChange (value, old) {
      let past = path.join(this.Main.paths.gameAppDataFolder, old.replaceAll("$PORT", this.Main.config.port));
      let newPath = this.Main.paths.apiFolderPath;
      this.handleFolderChange(past, newPath);
    }

    handlePluginsFolderChange (value, old) {
      let past = path.join(this.Main.paths.apiFolderPath, old.replaceAll("$PORT", this.Main.config.port));
      let newPath = this.Main.paths.pluginsFolderPath;
      this.handleFolderChange(past, newPath);
    }

    handleDependenciesFolderChange (value, old) {
      let past = path.join(this.Main.paths.apiFolderPath, old.replaceAll("$PORT", this.Main.config.port));
      let newPath = this.Main.paths.dependanciesFolderPath;
      this.handleFolderChange(past, newPath);
    }

    handlePluginConfigFolderChange (value, old) {
      let past = path.join(this.Main.paths.apiFolderPath, old.replaceAll("$PORT", this.Main.config.port));
      let newPath = this.Main.paths.pluginConfigsFolderPath;
      this.handleFolderChange(past, newPath);
    }

    handlePortChange (value, old) {
      let past = path.join(this.Main.paths.appdata, "config", old.toString());
      let newPath = this.Main.paths.serverConfigsFolder;
      this.handleFolderChange(past, newPath);

      past = path.join(this.Main.paths.gameAppDataFolder, this.Main.config.appDataFolderName.replaceAll("$PORT", old));
      newPath = this.Main.paths.apiFolderPath;
      this.handleFolderChange(past, newPath);

      past = path.join(this.Main.paths.apiFolderPath, this.Main.config.pluginsFolderPath.replaceAll("$PORT", old));
      newPath = this.Main.paths.pluginsFolderPath;
      this.handleFolderChange(past, newPath);

      past = path.join(this.Main.paths.apiFolderPath, this.Main.config.dependanciesFolderPath.replaceAll("$PORT", old));
      newPath = this.Main.paths.dependanciesFolderPath;
      this.handleFolderChange(past, newPath);

      past = path.join(this.Main.paths.apiFolderPath, this.Main.config.configsFolderPath.replaceAll("$PORT", old));
      newPath = this.Main.paths.pluginConfigsFolderPath;
      this.handleFolderChange(past, newPath);
    }

    handleFolderChange (past, newPath) {
      if (past == newPath) return;
      if (fs.existsSync(newPath)) {
        try {
          fs.rmSync(newPath, { recursive: true, force: true });
          this.Main.log(`Removed folder {oldPath}`, this.Main.main.lp({ oldPath: newPath }));
        } catch (e) {
          this.Main.log(`Error removing folder {oldPath}: {e}`, this.Main.main.lp({ oldPath: newPath, e: e?.code || e?.message || e, stack: e?.stack }));
          try {
            fs.rmSync(past, { recursive: true, force: true });
            this.Main.log(`Removed folder {oldPath}`, this.Main.main.lp({ oldPath: past }));
          } catch (e) {
            this.Main.log(`Error removing folder {oldPath}: {e}`, this.Main.main.lp({ oldPath: past, e: e?.code || e?.message || e, stack: e?.stack }));
          }
          return;
        }
      }
      if (fs.existsSync(past)) {
        try {
          fs.renameSync(past, newPath);
          this.Main.log(`Renamed folder from {oldPath} to {newPath}`, this.Main.main.lp({ oldPath: past, newPath }));
        } catch (e) {
          this.Main.log(`Error renaming folder {oldPath} to {newPath}: {e}`, this.Main.main.lp({ oldPath: past, newPath, e: e?.code || e?.message || e, stack: e?.stack }));
        }
      } else {
        this.Main.log(`Folder {oldPath} does not exist, skipping rename`, this.Main.main.lp({ oldPath: past }));
      }
    }
}