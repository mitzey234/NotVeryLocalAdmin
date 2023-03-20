const Net = require('net');
const EventEmitter = require('events');

exports.Client = class Client extends Net.Socket {
  constructor() {
    super();
    this.buffer = [];
    this.buffered = 0;
    this.messageLength = null;
    this.sendMessage = sendMessage.bind(this);
    this.on('data', onData.bind(this));
  }
}

function onData (chunk) {
  if (this.messageLength == null) {
    if (chunk.length < 8) return;
    this.messageLength = parseInt(chunk.readBigUInt64BE(0));
    chunk = chunk.slice(8,chunk.length);
  }
  var remaining = this.messageLength - this.buffered;
  //console.log("Data received: " + chunk.length, this.buffered + "/" + this.messageLength, remaining);
  if (chunk.length == remaining) {
    this.buffer.push(chunk);
    this.buffered += chunk.length;
    return onMessageComplete.bind(this)();
  } else if (chunk.length < remaining) {
    this.buffer.push(chunk);
    this.buffered += chunk.length;
    return;
  } else if (chunk.length > remaining) {
    var slice = chunk.slice(0, remaining);
    this.buffer.push(slice);
    this.buffered += slice.length;
    chunk = chunk.slice(remaining);
  }
  if (this.buffered == this.messageLength) onMessageComplete.bind(this)();
  if (chunk.length == 0) return;
  else onData.bind(this)(chunk);
}

function onMessageComplete () {
  var final = Buffer.concat(this.buffer);
  this.messageLength = null;
  this.buffer = [];
  this.buffered = 0;
  try {
    final = JSON.parse(final.toString());
  } catch (e) {
    console.log(e);
    return;
  }
  this.emit('message', final, this);
}

function sendMessage(object) {
  if (this.readyState != 'open') return;
  if (typeof object == "object" && !Buffer.isBuffer(object)) {
    object = JSON.stringify(object);
  }
  if (typeof object == "number") object = object.toString()
  if (typeof object == "string") {
    object = new Buffer.from(object);
  }
  if (Buffer.isBuffer(object)) {
    var head = new Buffer.alloc(8);
    var dataLen = object.length;
    head.writeBigUInt64BE(BigInt(dataLen), 0);
    object = Buffer.concat([head,object]);
    this.write(object);
    return dataLen;
  } else {
    throw "Unknown type of object: " + typeof object;
  }
}

function onConnection (socket) {
  socket.buffer = [];
  socket.buffered = 0;
  socket.messageLength = null;
  socket.sendMessage = sendMessage.bind(socket);
  socket.on('data', onData.bind(socket));
  this.emit("socket", socket);
}

exports.Server = class Server extends Net.Server {
  constructor() {
    super();
    this.on('connection', onConnection.bind(this));
  }
}
