const express = require('express');
const app = express();

app.get('/*splat', (req, res) => {
  res.send(req.params.splat);
});
