const express = require('express');
const app = express();
const router = express.Router();

app.get('*', (req, res) => {
  res.send(req.params[0]);
});

app.get('/*', (req, res) => {
  res.send('slash-star');
});

router.post('/files/*', (req, res) => {
  res.send('files');
});

app.put('/foo/*/bar', (req, res) => {
  res.send('mid');
});

app.get('/:id?', (req, res) => {
  res.send(req.params.id ?? 'none');
});

app.get('/users/:id?', (req, res) => {
  res.send('user');
});

app.get('/:id?/:name?', (req, res) => {
  res.send('two');
});

app.get('/api/:version?/:id?', (req, res) => {
  res.send('api');
});

app.all('/(.*)', (req, res) => {
  res.send('group');
});

app.get('/foo/(.*)', (req, res) => {
  res.send('foo-group');
});

app.get('/(.*)/bar', (req, res) => {
  res.send('group-bar');
});

app.get('/:id(\\d+)', (req, res) => {
  res.send(req.params.id);
});

app.get('/:file.:ext?', (req, res) => {
  res.send('ext');
});

app.get('/[discussion|page]/:slug', (req, res) => {
  res.send('alt');
});

app.get('/foo+', (req, res) => {
  res.send('plus');
});

app.get('**', (req, res) => {
  res.send('double');
});

app.get('/foo*', (req, res) => {
  res.send('glued');
});

app.get(['/health', '/:status?'], (req, res) => {
  res.send('health');
});

app.get(`/:template?`, (req, res) => {
  res.send('template');
});

app.get("/double/:id?", (req, res) => {
  res.send('double-quote');
});

app.use('/*splat', (req, res) => {
  res.send('named');
});

app.get('/{*splat}', (req, res) => {
  res.send('optional-root');
});

app.get('/users/:id', (req, res) => {
  res.send(req.params.id);
});

app.get('/:file{.:ext}', (req, res) => {
  res.send('braces');
});

app.get(/\/legacy\/(.*)/, (req, res) => {
  res.send(req.params[0]);
});

router.route('/route/:id?').get((req, res) => {
  res.send('routed');
});

app.del('/users/:id', (req, res) => {
  res.send('gone');
});

app.post('/form', (req, res) => {
  const id = req.param('id');
  res.sendfile('/tmp/x');
  res.json({ id }, 201);
  res.send({ name: 'Ruben' }, 200);
  res.send(204);
  res.send(status);
  req.query = {};
  req.query.page = 1;
  res.send('form');
});

function mount(router) {
  router.patch('/mounted/:id?', (req, res) => {
    res.send('mounted');
  });
}

const server = express();
server.get('/server/:id?', (req, res) => {
  res.send('server');
});

const api = express.Router();
api.get('/from-api/*', (req, res) => {
  res.send('from-api');
});

const inline = require('express').Router();
inline.get('/inline/*', (req, res) => {
  res.end('inline');
});

app?.get?.('/optional/:id?', (req, res) => {
  res.send('optional');
});

app['get']('/computed/:id?', (req, res) => {
  res.send('computed');
});

app.use((req, res, next) => next());

const cache = {
  get(path) {
    return path;
  },
};
cache.get('/decoy/:id?');
const sample = "app.get('/decoy/(.*)', fn)";
// app.get('/*', handler)
