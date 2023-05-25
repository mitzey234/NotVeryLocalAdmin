using PluginAPI.Core.Attributes;
using PluginAPI.Enums;
using MEC;
using System.Collections.Generic;
using System;
using PluginAPI.Core;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using PlayerRoles.Spectating;
using PlayerRoles;
using Respawning;
using Hints;

//Serves as a generic event handler object for any common events that don't pertain to any specific plugin or feature
namespace NVLAMonitorPlugin.Utils
{
    public class EventHandlers
    {
        GameObject go;

        [PluginEvent(ServerEventType.WaitingForPlayers)]
        public void OnWaitingForPlayers()
        {
            if (go == null)
            {
                go = new GameObject();
                go.AddComponent<MonitorComp>();
            }
        }
    }

    public class MonitorComp : MonoBehaviour
    {
        private const float rate = 0.75f; //this is like the absolute limit, thanks northwood
        private float timer = 0f;

        private void Awake()
        {
            
        }
        
        private void Update()
        {
            timer += Time.deltaTime;
            if (timer <= rate) return;
            JObject o = (JObject)JToken.FromObject(new data());
            Console.Error.WriteLine("////NVLAMONITORSTATS--->" + o.ToString().Replace("\n", "").Replace("\r", ""));
            timer = 0f;
        }
    }

    public class data
    {
        public String[] players;

        public int tps;

        public data ()
        {
            players = Player.GetPlayers().Where(x => !x.IsServer).Select(x => x.Nickname).ToArray();
            tps = (int)Math.Round(1.0f / Time.smoothDeltaTime);
        }
    }
}
