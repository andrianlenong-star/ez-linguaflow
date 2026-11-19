import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { SERVER_CONFIG } from './config.ts';
import {
  requestContextAndLogger,
  requestTimeoutMiddleware,
} from './middleware/security.ts';
import { apiRouter } from './routes/api.ts';

export function isAllowedCorsOrigin(params: {
  origin?: string;
  host?: string;
  forwardedHost?: string | string[];
  allowedOrigins: string[];
}): boolean {
  const { origin, host, forwardedHost, allowedOrigins } = params;
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;

  const normalizedOrigin = origin.trim().replace(/\/+$/, '');
  if (allowedOrigins.includes(normalizedOrigin)) return true;

  let originHost: string | null = null;
  try {
    originHost = new URL(normalizedOrigin).host.toLowerCase();
  } catch {
    return false;
  }

  const rawForwarded = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  const firstForwardedHost =
    typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim().toLowerCase() : '';
  const cleanHost = typeof host === 'string' ? host.split(',')[0].trim().toLowerCase() : '';

  return Boolean(
    (firstForwardedHost && originHost === firstForwardedHost) ||
      (cleanHost && originHost === cleanHost),
  );
}

/**
 * Builds the shared Express application with security headers, CORS, logging,
 * /api router, API 404 fallback, and structured error handling.
 * Used identically by both server.ts (Node/Cloud Run/AI Studio) and api/index.ts (Vercel Serverless).
 */
export function createApiApp(): express.Express {
  const app = express();

  // Required behind Cloud Run / Vercel / reverse proxies so req.ip & req.protocol reflect HTTPS/client IP accurately
  app.set('trust proxy', 1);

  // Security headers compatible with Vite dev mode, Android clients, Vercel, and AI Studio iframe preview
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));

  app.use(requestContextAndLogger);

  // CORS for /api consumers (Web same-origin including X-Forwarded-Host, configured ALLOWED_ORIGINS, and native Android clients)
  app.use(
    '/api',
    cors((req, callback) => {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      const host = typeof req.headers.host === 'string' ? req.headers.host : undefined;
      const forwardedHost = req.headers['x-forwarded-host'];

      if (
        isAllowedCorsOrigin({
          origin,
          host,
          forwardedHost,
          allowedOrigins: SERVER_CONFIG.allowedOrigins,
        })
      ) {
        callback(null, {
          origin: true,
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
        });
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS policy.`));
    }),
  );

  app.use('/api', requestTimeoutMiddleware, apiRouter);

  // API 404 fallback
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      code: 'NOT_FOUND',
    });
  });

  // Multer, CORS, and JSON parse error handler
  app.use(
    (
      err: Error & { code?: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err?.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: 'Uploaded file exceeds the allowed size limit.',
          code: 'FILE_TOO_LARGE',
        });
        return;
      }
      if (err?.message?.includes('CORS policy')) {
        res.status(403).json({
          error: err.message,
          code: 'CORS_FORBIDDEN',
        });
        return;
      }
      if (err) {
        res.status(400).json({
          error: err.message || 'Bad request.',
          code: 'BAD_REQUEST',
        });
        return;
      }
      next();
    },
  );

  return app;
}
