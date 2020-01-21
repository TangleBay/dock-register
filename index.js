let nanoid = require("nanoid");
let http = require('http')
let https = require('https')
let httpProxy = require('http-proxy');
let proxy = httpProxy.createProxyServer();
let config = require('./config.json');
let dns = require('dns');

let healthy = true

// Create server and add key to post req if undefined
http.createServer(async (req, res) => {
  try {
    if (!healthy) {
      throw "Not all LBs are up, try it again later"
    }
    if (req.method == 'POST') {
      let ip = req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',').pop() ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress
      //check if not ipv6
      if (!/^((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4}))*::((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4}))*|((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4})){7}$/g.test(ip)) {
        ip = ip.slice(ip.lastIndexOf(':') + 1)
      }
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

      //check if https
      if (json.url.slice(0, 8) != 'https://') {
        throw "https required"
      }

      // get ip address from url
      let url = json.url.slice(8).split(':')[0].split('/')[0]
      let urlip = await lookupPromise(url)

      //check ip address
      if (urlip != ip) {
        throw "IP from request doesn't match URL"
      }

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
      })
    }
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ error: e }, null, 1));
    res.end();
    console.error(e);
  }
}).listen(config.port);

proxy.on('error', function (e) {
  console.error(e);
});

async function checkHealth() {
  try {
    // console.log("currenthealth:" + healthy);
    let newHealthStatus = true
    for (let target of config.targets) {
      let info = await fetch(target + "/actuator/health")
      if (info.status != 'UP') {
        console.error(target + " isn't up");
        newHealthStatus = false
      }
    }
    healthy = newHealthStatus
  } catch (e) {
    console.log(e);
  }
}

//checkHealth request evey x seconds
setInterval(() => checkHealth(), config.requestHealthIntervall*1000);

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

const lookupPromise = (url) => {
  return new Promise((resolve, reject) => {
    dns.lookup(url, (err, address, family) => {
      if (err) reject(err);
      resolve(address);
    });
  });
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';

      res.on("data", (chunk) => {
        body += chunk;
      });

      res.on("end", () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          resolve({ "status": e })
        }
      });

    }).on("error", (error) => {
      resolve({ "status": error })
    })
  })
}

// Create your target server

// http.createServer(async function (req, res) {
//   console.log("antwort");
//   let body = '';
//   await req.on('data', function (data) {
//     body += data;
//   });
//   console.log(body);
//   console.log(req.headers);
//   // res.writeHead(200, { 'Content-Type': 'text/plain' });
//   // res.write('request successfully proxied to: ' + req.url + '\n' + JSON.stringify(req.headers, true, 2));
//   // res.end();
// }).listen(9008);