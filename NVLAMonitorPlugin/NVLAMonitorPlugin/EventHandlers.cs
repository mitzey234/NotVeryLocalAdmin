using PluginAPI.Core.Attributes;
using PluginAPI.Enums;
using MEC;
using System.Collections.Generic;
using System;
using PluginAPI.Core;
using System.Linq;
using Newtonsoft.Json.Linq;

//Serves as a generic event handler object for any common events that don't pertain to any specific plugin or feature
namespace NVLAMonitorPlugin.Utils
{
    public class EventHandlers
    {

        CoroutineHandle coroutine;

        [PluginEvent(ServerEventType.WaitingForPlayers)]
        public void OnWaitingForPlayers()
        {
            coroutine = Timing.RunCoroutine(loop());
        }

        public IEnumerator<float> loop()
        {
            while (true)
            {;
                JObject o = (JObject)JToken.FromObject(new data());
                Console.Error.WriteLine("////NVLAMONITORSTATS--->" + o.ToString().Replace("\n", "").Replace("\r", ""));
                yield return Timing.WaitForSeconds(0.75f);
            }
        }
    }

    public class data
    {
        public String[] players;

        public data ()
        {
            players = Player.GetPlayers().Where(x => !x.IsServer).Select(x => x.Nickname).ToArray();
        }
    }
}
