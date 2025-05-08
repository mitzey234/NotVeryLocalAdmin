const util = require("./util.js");

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
  
      this.functionMaps.set("seq.apiKey", this.restartSeq.bind(this));
    }
  
    /**
     * @param {{path: string, value: *, old: *}} data 
     */
    handleSettingChange(data) {
      if (this.disabled) return;
      console.log("Setting changed: ", data);
      if (!Array.isArray(data.value) && !Array.isArray(data.old) && data.value == data.old) return;
      if (Array.isArray(data.value) && Array.isArray(data.old)) {
        data.value.sort(util.s);
        data.old.sort(util.s);
        if (util.equals(data.value, data.old)) return;
      }
      if (this.functionMaps.has(data.path)) this.functionMaps.get(data.path)(data.value, data.old, data.path);
      else if (data.path.startsWith("globalServerSettings.") && this.functionMaps.has("globalServerSettings")) this.functionMaps.get("globalServerSettings")(data.value, data.old, data.path);

      try {
        this.Main.config.save();
      } catch (e) {
        this.Main.error("Failed saving settings: {e}", this.Main.lp({ e }));
      }
    }
}