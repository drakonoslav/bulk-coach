const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");

const config = getDefaultConfig(__dirname);

config.server = config.server || {};
const originalMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (metroMiddleware) => {
  const enhanced = originalMiddleware
    ? originalMiddleware(metroMiddleware)
    : metroMiddleware;

  return (req, res, next) => {
    if (req.url && req.url.startsWith("/api/")) {
      const options = {
        hostname: "localhost",
        port: 5000,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "localhost:5000" },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on("error", (err) => {
        console.error("API proxy error:", err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Backend unavailable" }));
      });

      req.pipe(proxyReq, { end: true });
      return;
    }

    return enhanced(req, res, next);
  };
};

module.exports = config;
