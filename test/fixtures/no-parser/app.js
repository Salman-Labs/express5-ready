const express = require('express');
const app = express();

app.post('/a', (req, res) => {
  const { body } = req;
  res.send(body && body.name);
});

app.post('/b', (req, res) => {
  res.send(req.body && req.body.id);
});
