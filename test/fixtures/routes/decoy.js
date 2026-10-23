const cache = new Map();

function get(path) {
  return path;
}

cache.get('/decoy/:id?');
get('/decoy/(.*)');
const source = "app.get('/decoy/*', function (req, res) { res.sendfile('/tmp/x'); req.param('id'); });";
// app.del('/decoy/:id?')
console.log('/:id?');
