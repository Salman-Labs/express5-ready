import express = require('express');

const server = express();

server.get('/legacy/*', (_req, res) => {
  res.send('legacy');
});
