import express from 'express';

const app = express();

app.get('/esm/:id?', (req, res) => {
  res.send('esm');
});
