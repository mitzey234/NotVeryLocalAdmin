# NotVeryLocalAdmin

NotVeryLocalAdmin is a free to use server manager for SCP Secret Laboratory dedicated servers. It's built to replace LocalAdmin which ships with the dedicated server as a launcher and TCP listening server. The purpose of this project is to do almost everything LocalAdmin does but with extra features for babysitting your server(s).

NotVeryLocalAdmin supports daily restarts of which you can specify what time of day (locally) to restart all servers. It also features a memory check function which can check your systems free memory and restart your servers gracefully (either using restartnextround or using silentrestart) in the event there is a memory leak. It will also warn you if your memory usage is too high.

The primary feature of this program is a constant server check that will check to make sure the server console is alive and restart the process should it notice the server is not responding. We never thought we'd need a feature like this but Northwood x Exiled brought this up.

The best part, this program supports multiple servers instead of running multiple iterations of LocalAdmin. Neat.

# Setup

## Running it directly (Node.js)

If you want to just directly launch the program, your going to have to have [Node.js](https://nodejs.org/en/) installed. I built this project in version 15, but if you use older versions try to stay above version 12. If your lazy use [nvm](https://github.com/nvm-sh/nvm) to switch node versions simply.

Using the node version is simple, you just need to run `npm i` first to install dependencies, then `node index.js` in the project folder and it will search the current working directory for the config file.

For gods sake, please make sure you've CD'ed to the correct folder, otherwise you'll have errors and log files showing up places you don't want them..

## Running it from the compiled node packers

Current versions of the project are packed using [pkg](https://www.npmjs.com/package/pkg) and released on the github. There's a version for linux, windows, and macOS (if for some reason you manage to get a Dedi on a f***ing mac don't ask).

Using all these is simple, you just need to run the executable and it will search the current working directory for the config file.

For gods sake, once again, please make sure you've CD'ed to the correct folder, otherwise you'll have errors and log files showing up places you don't want them..

## Config files

The most important part is the config file. Your config file should be in your current working directory when you run the application, it should be called `config.json` and contain the following properties:

SCPExecutable: Should be a string that points directly to the SCP SL executable for the server. If windows `SCPSL.exe`, if linux `SCPSL.x86_64`. This could change if Northwood decides to change the executable name so check file paths.

restartTime: Should be an object containing two properties, hours, and minutes. Both are just numbers corresponding to the time to restart the servers automatically in local time. The time is in 24 hours, starting from 0-23. If you need to disable restarts, chose any negative number for hours.

checkinTime: Should be a number in seconds for how often to check the status of the server. This check is intended to watch for when the console freezes, and restart the server if the console fails to respond 3 times. The timeout however is 10 seconds. A config option for this may be added in the future pending requests.

serverStartTimeout: Should be a number in seconds, when the server is first started the program starts a timer which will wait this amount of time for the server to reach the ready state from start up. The ready state is typically when the server prints "waiting for players" in the console. Only when this event is fired does the timer stop. If the server takes too long, the program will restart the server assuming something went wrong.

serverRestartReqTimeout: Should be a number in seconds, this is the amount of time the server will wait for the server to respond to a restart request. Whether its restartnextround or silentrestart, the client will wait this time 3 times. If the server does not respond, it will forcibly restart the server by killing the process, assuming the process froze.

logFolder: Should be a string file path pointing to a folder to store log files in. This can be from current working directory, EX. `./Logs`, or be somewhere completely different. In the future, the option to disable logging may be added.

minimizeLog: Should be a Boolean value (0 or 1 can also be used I suppose), this will toggle a log file cleaning feature I made. Its designed to clean up a few of the common errors or messages that SCP SL's STDOUT prints to help reduce the size of your 15GB log files. PLEASE, if your trying to debug something in this game, doesn't matter what it is, disable this feature, its possible it will clear debug lines or exceptions that your looking for in your logs.

logStdio: Should be a Boolean value, this controls whether or not to log the STDOUT and STDERR pipes of the SCP SL executable to the server logs. Please note STDERR is ALWAYS logged because you'll regret not capturing that one exception.

loggingMaxDays: Should be likely a string such as "30d", which will tell the log rotation to delete logs older than 30 days.

loggingMaxSize: Should be a string that tells the log rotation to rotate log files when they reach a certain size, example: "20m" is 20MB. Use 'k', 'm', or 'g' for this value.

memoryChecker: Should be a Boolean value, which controls whether or not to preform memory usage checking

servers: Should be an array [], of objects. Each object should be a server with the following properties:
```
"uid": "1234abcd", //This should be a unique Identifier that the program can use to differentiate this server if theres servers with the same labels. No two servers should have the same uid
"p": 7780, //The port number of this server
"l": "Server-4", //This is a server label, its cleaner than a UID, gives it a nice title which is used in the console and logging.
"disabled": true //Whether or not this server is disabled, if disabled, it will not auto start, and cannot be started until enabled
```
## Example config

In case you need it, here's an example config for 5 servers on different ports:
```
{
    "SCPExecutable": "A:/SteamLibrary/SteamApps/common/SCP Secret Laboratory Dedicated Server/SCPSL.exe",
    "restartTime": {
        "hours": 4,
        "minutes": 0
    },
    "checkinTime": 5,
    "serverStartTimeout": 60,
    "serverRestartReqTimeout": 3,
    "logFolder": "./Logs",
    "minimizeLog": true,
    "logStdio": true,
    "loggingMaxDays": "30d",
    "loggingMaxSize": "20m",
    "memoryChecker": true,
    "servers": [
        {
            "uid": "12345a",
            "p": 7777,
            "l": "Server-1",
            "disabled": false
        },
        {
            "uid": "12345b",
            "p": 7778,
            "l": "Server-2",
            "disabled": true
        },
        {
            "uid": "12345c",
            "p": 7779,
            "l": "Server-3",
            "disabled": true
        },
        {
            "uid": "12345d",
            "p": 7780,
            "l": "Server-4",
            "disabled": true
        },
        {
            "uid": "12345e",
            "p": 7781,
            "l": "Server-5",
            "disabled": true
        }
    ]
}
```

# Commands

The console in this program also has some commands, note that the console can be a little janky in SSH sessions:

stop - (Usage: stop <server label|UID|port>) Stop a specific server
start - (Usage: start <server label|UID|port>) Start a specific server
restart - (Usage: restart <server label|UID|port>) Restart a specific server
restartforce | rf | fr - (Usage: fr <server label|UID|port>) Forcibly restarts a specific server, first with sr, then with killing the process if that doesn't work. Future commands might be added for literally deleting the server process.
enable - (Usage: enable <server label|UID|port>) Enable a specific server, saves it to the config too
disable - (Usage: disable <server label|UID|port>) Disable a specific server, saves it to the config too
exec | run - (Usage: run <server label|UID|port> <args>) Sends a console command to the specific server. Everything after the server Identifier is sent to the console as a string so it can be any length
quit | exit - (Usage: quit) Stops all servers and exits.
startAll | sa - (Usage: sa) Starts all the servers that are enabled
stopAll | sta - (Usage: sta) Stops all the servers that are running
restartAll | ra - (Usage: ra) Restarts all the servers that are running or not running (if they are enabled)
enableAll | ea - (Usage: ea) Enables all configured servers, saves to config
disableAll | da - (Usage: da) Disables all configured servers, saves to config

# Future stuffs

In the future I might make the program a bit more optimized in terms of handling current working directory and the actual current directory the program is running in.
I also might add execution arguments so you can just do -config <config folder path here> so it can work a little better.
Some other config options may also need to be added to make things a little bit more configurable for hosts but I'll add what people request.

# Issues
If you have any issues feel free to post them. If you run into errors or crashes please provide me with screenshots or console output as well as what you did to reach that state. Please note this repo will only be maintained as often as I can be available. I have a life too, and I can't spend it babysitting servers, let alone repos, why do you think I made this? :kek:

If you want to help with this project you may contact me at alex1001(at)live(dot)ca
Or via discord if you know where to find me. Preferably discord cause my email is a trash can.

If your on windows, fair warning about a strange bug with the packed version of this program, if you kill the program using the X button on the window, it tells all the dedicated servers to exit which causes them to quit Unexpectedly which causes the program to restart them while windows is trying to kill the program. It behaves very strangely and I can't figure out how to have node capture when this happens. Please use the quit or exit commands instead when exiting..
If you DON'T want to do that and continue using the X button, don't complain to me why this happens cause I have no clue and I did my best to fix it ¯\_(ツ)_/¯
