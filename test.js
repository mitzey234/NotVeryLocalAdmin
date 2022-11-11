var express = require('express');
var app = express();
const path = require("path")

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, "steamcmd_osx.tar.gz"));
})

app.listen(3000);