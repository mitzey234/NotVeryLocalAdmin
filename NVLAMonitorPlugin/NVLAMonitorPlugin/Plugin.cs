using System;
using LabApi.Events;
using LabApi.Events.CustomHandlers;
using LabApi.Loader.Features.Plugins;
using NVLAMonitorPlugin.Utils;

namespace NVLAMonitorPlugin
{
    public class NVLAMonitor : Plugin
    {
        public static Plugin Instance { get; private set; }
        
        public EventHandlers Events { get; } = new ();
        
        public override string Name => "NVLAMonitorPlugin";
        public override string Description { get; } = "Plugin to monitor SCPSL server status and provide updates to NVLA";
        public override string Author { get; } = "Mitzey";
        public override Version Version { get; } = new(1, 0, 0);
        public override Version RequiredApiVersion { get; } = new(1, 0, 0);

        public NVLAMonitor()
        {
            Instance = this;
        }

        public override void Enable()
        {
            CustomHandlersManager.RegisterEventsHandler(Events);
        }

        public override void Disable ()
        {
            CustomHandlersManager.UnregisterEventsHandler(Events);
        }
    }
}
