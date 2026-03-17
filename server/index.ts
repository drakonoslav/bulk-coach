import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import * as fs from "fs";
import * as path from "path";

// ── NEW CANONICAL SPINE ROUTES (Pass 3+) ─────────────────────────────────────
// These are registered AFTER registerRoutes so the global Bearer auth middleware
// still applies. Each handler also enforces X-User-Id explicitly (no fallback).
import { uploadRouter }           from "./routes/upload.js";
import { workbookRouter }         from "./routes/workbook.js";
import { biologRouter }           from "./routes/biolog.js";
import { biologDerivedRouter }    from "./routes/biolog-derived.js";
import { nutritionRouter }        from "./routes/nutrition.js";
import { colonyRouter }           from "./routes/colony.js";
import { workbookDashboardRouter } from "./routes/workbook-dashboard.js";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    // Allow localhost origins for Expo web development (any port)
    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-User-Id",
      );
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "200mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "200mb" }));
  app.use(express.raw({ limit: "200mb", type: "application/octet-stream" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  // In production Replit deployments, REPLIT_INTERNAL_APP_DOMAIN is the
  // real public hostname (e.g. bulkcoach-drakonoslav.replit.app).
  // The forwarded headers contain the internal proxy address (127.0.0.1:xxxx)
  // which must NOT be used for QR code / exps:// URLs.
  const replitPublicDomain = process.env.REPLIT_INTERNAL_APP_DOMAIN;

  let host: string;
  let protocol: string;

  if (replitPublicDomain) {
    // Strip any leading https:// that Replit sometimes includes
    host = replitPublicDomain.replace(/^https?:\/\//, "");
    protocol = "https";
  } else {
    const forwardedProto = req.header("x-forwarded-proto");
    protocol = forwardedProto || req.protocol || "https";
    const forwardedHost = req.header("x-forwarded-host");
    host = forwardedHost || req.get("host") || "localhost:5000";
  }

  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  log("Serving web app from dist/, mobile bundles from static-build/");

  // 1. Expo Go manifest — mobile only (expo-platform: ios / android header)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    if (req.path !== "/" && req.path !== "/manifest") return next();

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    next();
  });

  // 2. Named asset directory (fonts, images)
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets"), { maxAge: "1d" }));

  // 3. Expo web bundle (dist/) — serves index.html + hashed JS/CSS for browsers
  app.use(express.static(path.resolve(process.cwd(), "dist"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      }
    },
  }));

  // 4. Mobile Expo OTA bundles (static-build/) — served to Expo Go
  app.use(express.static(path.resolve(process.cwd(), "static-build"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      }
    },
  }));

  // 5. SPA fallback — Expo Router uses client-side routing, so every non-API
  //    path that does not match a static file must return dist/index.html
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    const indexPath = path.resolve(process.cwd(), "dist", "index.html");
    if (fs.existsSync(indexPath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      return res.sendFile(indexPath);
    }
    next();
  });
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);

  // ── Register new canonical spine routes FIRST ───────────────────────────────
  // MUST be registered before registerRoutes() so canonical routes take priority
  // over legacy routes mounted at the same paths (e.g. /api/workbooks in routes.ts).
  // New source of truth: workbook_snapshots, snapshot_sheet_rows, biolog_rows
  // Paths no longer allowed: MemStorage, local_default fallback on these routes
  app.use(uploadRouter);
  app.use(workbookRouter);
  app.use(biologRouter);
  app.use(biologDerivedRouter);
  app.use(nutritionRouter);
  app.use(colonyRouter);
  app.use(workbookDashboardRouter);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );

  server.requestTimeout = 300000;
  server.headersTimeout = 300000;
  server.keepAliveTimeout = 120000;
})();
