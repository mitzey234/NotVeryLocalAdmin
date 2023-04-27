const axios = require('axios');
const { EventEmitter } = require('stream');

let ignoreProperties = ["@i", "@l", "@m", "@mt", "date", "Id"];

class seqLog {
    /** @type string */
    level;

    /** @type Date */
    date;

    /** @type string */
    id;

    /** @type string */
    message;

    constructor (e) {
        this.level = e["@l"];
        this.data = e.date;
        this.id = e.Id;
        this.message = e["@m"];
        for (let i in e) if (typeof e[i] != "object" && typeof e[i] != "function" && typeof e[i] != "symbol" && !ignoreProperties.includes(i)) this[i] = e[i];
    }
}

class seqTail extends EventEmitter{

    /** @type string */
    latest;

    /** @type boolean */
    inprog = false;

    interval;

    /** @type string */
    host;

    /** @type string */
    apiKey;

    /**
     * 
     * @param {string} host 
     * @param {string} apiKey 
     * @param {number} rate 
     */
    constructor (host = "127.0.0.1", apiKey, rate = 50) {
        super();
        this.inprog = false;
        this.latest = null;
        this.host = host;
        this.apiKey = apiKey;
        this.interval = setInterval(this.run.bind(this), rate);
    }
    
    async getLatest () {
        let data = await axios({
            method: 'get',
            url: 'http://'+this.host+'/api/events',
            params: {
                count: 1,
                apiKey: this.apiKey,
                render: true,
            },
            responseType: "json"
        });
        data = data.data;
        return data[0].Id;
    }

    async run () {
        if (this.inProg) return;
        this.inProg = true;
        try {
            if (this.latest == null) this.latest = await this.getLatest();
        } catch (e) {
            this.emit("error", e);
            setTimeout(function () {this.inProg = false;}.bind(this), 5000);
            return;
        }
        let data;
        try {
            data = await axios({
                method: 'get',
                url: 'http://'+this.host+'/api/data',
                params: {
                    apiKey: this.apiKey,
                    format: "json",
                    q: "SELECT ToIsoString(@Timestamp), @Id, @Data, @Arrived FROM stream WHERE @Arrived > Arrived('"+this.latest+"') Order By @Arrived asc limit 1000"
                },
                responseType: "json"
            });
        } catch (e) {
            this.emit("error", e);
            setTimeout(function () {this.inProg = false;}.bind(this), 5000);
            return;
        }
        data = data.data;
        let d = [];
        for (i in data.Rows) {
            let row = data.Rows[i];
            d.push(Object.assign(row[2], {date: new Date(row[0]), Id: row[1]}));
        }
        data = d;
        for (var i = 0; i < data.length; i++) {
            let row = new seqLog(data[i]);
            this.emit("event", row);
        }
        if (data.length == 0) return this.inProg = false;
        this.latest = data[data.length-1].Id;
        this.inProg = false;
    }

    destroy () {
        clearInterval(this.interval);
        this.latest = null;
        this.inprog = false;
    }
}

let test = new seqTail("192.168.1.121", "xiP1sphcjDaQOcjr9WQx", 50);
test.on("event", function (e) {
    console.log(e);
});