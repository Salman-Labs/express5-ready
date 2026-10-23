const express = require('express');
const app = express();

app.post('/users', (req, res) => {
  res.send(req.body.name);
});
