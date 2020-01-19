let nanoid = require("nanoid");
let http = require('http')
let httpProxy = require('http-proxy');
let proxy = httpProxy.createProxyServer();
let config = require('./config.json');

// Create server and add key to post req if undefined
http.createServer(async (req, res) => {
  if (req.method == 'POST') {
    let body = '';
    await req.on('data', function (data) {
      body += data;
      // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
      if (body.length > 1e6) {
        // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
        req.connection.destroy();
      }
    });
    let json = JSON.parse(body)
    //add password if undefined
    if (typeof json.password == 'undefined') {
      json.password = generate_key(81)
    }
    req.body = JSON.stringify(json);
  }

  for (target of config.targets) {
    proxy.web(req, res, {
      changeOrigin: true,
      target: target
    });
  }
}).listen(config.port);

//restream parsed body before proxying
proxy.on('proxyReq', async function (proxyReq, req, res, options) {
  if (!req.body || !Object.keys(req.body).length) {
    return;
  }

  var contentType = proxyReq.getHeader('Content-Type');
  var bodyData;

  if (contentType === 'application/json') {
    bodyData = JSON.stringify(req.body);
  }

  if (contentType === 'application/x-www-form-urlencoded') {
    bodyData = queryString.stringify(req.body);
  }

  if (bodyData) {
    // proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
    // proxyReq.write(bodyData);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(req.body));
    proxyReq.write(req.body);
  }
});

function generate_key() {
  let id = nanoid(140);
  let key = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return key.slice(0, 81)
}


// Create your target server
//
// http.createServer(async function (req, res) {
//   console.log("antwort");
//   let body = '';
//     await req.on('data', function (data) {
//       body += data;
//     });
//     console.log(body);
//   // res.writeHead(200, { 'Content-Type': 'text/plain' });
//   // res.write('request successfully proxied to: ' + req.url + '\n' + JSON.stringify(req.headers, true, 2));
//   // res.end();
// }).listen(9008);