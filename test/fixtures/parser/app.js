const express = require('express');
const { json } = require('express');
const app = express();

app.use(json());
app.use(express.urlencoded({ extended: true }));

app.post('/users', (req, res) => {
  res.json({ name: req.body.name });
});
