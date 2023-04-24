const axios = require('axios');

let latest = null;

var inProg = false;

let SQLQ = "select @Id, @Timestamp, @Message, @Properties from stream where @Arrived > Arrived('$eid') and @Timestamp > Now() - 1d order by @Timestamp desc limit 10000";

async function test () {
    let data = await axios({
        method: 'get',
        url: 'http://192.168.1.121/api/events',
        params: {
            count: 1,
            apiKey: "xiP1sphcjDaQOcjr9WQx",
            render: true,
        },
        responseType: "json"
    });
    data = data.data;
    latest = data[0].Id;
}

let arr = [];

async function run () {
    if (inProg) return;
    inProg = true;
    if (latest == null) await test();
    let data = await axios({
        method: 'get',
        url: 'http://192.168.1.121/api/data',
        params: {
            apiKey: "xiP1sphcjDaQOcjr9WQx",
            render: true,
            q: SQLQ.replace("$eid", latest)
        },
        responseType: "json"
    });
    //console.log("Data Got");
    data = data.data;
    data = data.Rows;
    for (var i = data.length-1; i >= 0; i--) {
        if (!arr.includes(data[i][0])) {
            arr.push(data[i][0]);
            if (arr.length > 100) arr.shift();
            console.log(data[i][2]);
        }
    }
    if (data.length == 0) return inProg = false;
    latest = data[0][0];
    inProg = false;
}
setInterval(run, 100);