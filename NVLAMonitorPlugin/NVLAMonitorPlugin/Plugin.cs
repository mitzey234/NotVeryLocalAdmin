using PluginAPI.Core.Attributes;
using PluginAPI.Events;
using System;
using PlayerRoles;
using System.Collections.Generic;
using System.IO;
using Footprinting;
using PluginAPI.Core;
using Interactables.Interobjects;
using Player = PluginAPI.Core.Player;

namespace NVLAMonitorPlugin
{
    public class Plugin
    {
        public static Plugin Singleton { get; private set; }
        
        
        [PluginEntryPoint("NVLAMonitorPlugin", "1.0.0", "NVLA monitoring plugin used for giving NVLA server status updates", "Mitzey")]
        void LoadPlugin()
        {
            Singleton = this;
            EventManager.RegisterEvents<Utils.EventHandlers>(this);
        }
        
        [PluginUnload]
        void UnloadPlugin()
        {
            EventManager.UnregisterEvents<Utils.EventHandlers>(this);
        }
        
        [PluginConfig]
        public Config PluginConfig;
    }
}
