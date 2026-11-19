import crypto from 'node:crypto';
import type express from 'express';
import { SERVER_CONFIG } from '../config.ts';
import type { AuthenticatedRequest } from './auth.ts';

const rateBuckets = new Map<string, number[]>();

export function requestContextAndLogger(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction,
): void {
  const incomingId = req.headers['x-request-id'];
  const requestId =
    typeof incomingId === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(incomingId)
      ? incomingId
      : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    const durationMs = Date.now() - startedAt;
    // Privacy-safe structured JSON log: never logs source text, translations, tokens, or API keys
    const logEntry = {
      severity: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARNING' : 'INFO',
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
      uid: req.user?.uid || 'anonymous',
    };
    if (SERVER_CONFIG.logLevel !== 'silent') {
      console.log(JSON.stringify(logEntry));
    }
  });

  next();
}

export function requestTimeoutMiddleware(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction,
): void {
  const isHeavyMediaRoute =
    req.path === '/translate/document' ||
    req.path === '/translate/image' ||
    req.path === '/translate/voice';
  const timeoutMs = isHeavyMediaRoute
    ? Math.max(SERVER_CONFIG.requestTimeoutMs, 65_000)
    : SERVER_CONFIG.requestTimeoutMs;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        error: `Request timed out after ${Math.round(timeoutMs / 1000)}s.`,
        code: 'REQUEST_TIMEOUT',
        requestId: req.requestId,
      });
    }
  }, timeoutMs);
  timer.unref?.();

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
}

export function rateLimitMiddleware(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction,
): void {
  const key = req.user?.uid
    ? `uid:${req.user.uid}`
    : `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const windowMs = SERVER_CONFIG.rateLimitWindowMs;
  const limit = SERVER_CONFIG.rateLimitMax;

  const stamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  const resetSeconds = Math.ceil(windowMs / 1000);

  if (stamps.length >= limit) {
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));
    res.status(429).json({
      error: 'Too many requests. Please wait a moment before sending more requests.',
      code: 'RATE_LIMIT_EXCEEDED',
      requestId: req.requestId,
    });
    return;
  }

  stamps.push(now);
  rateBuckets.set(key, stamps);

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - stamps.length)));
  res.setHeader('X-RateLimit-Reset', String(resetSeconds));
  next();
}
