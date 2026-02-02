using System;
using CommandSystem;
using LabApi.Features.Wrappers;
using RemoteAdmin;

namespace NVLAMonitorPlugin
{
	[CommandHandler(typeof(RemoteAdminCommandHandler))]
	[CommandHandler(typeof(GameConsoleCommandHandler))]
	class ReloadVerkey : ICommand
	{
		public string[] Aliases { get; set; } = { "rvk" };

		public string Description { get; set; } = "Reloads the central server verification key from the filesystem";
		
		string ICommand.Command { get; } = "reloadverkey";

		public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
		{
			if (sender is PlayerCommandSender && !Player.Get(sender).RemoteAdminAccess)
			{
				response = "You do not have access to this command.";
				return false;
			}
			
			ServerConsole.RefreshToken();

			response = "Reloaded";
			return true;
		}
	}
}
