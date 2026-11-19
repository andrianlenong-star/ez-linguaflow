import type { IncomingMessage, ServerResponse } from 'node:http';
import type express from 'express';
import { createApiApp } from '../server/app.ts';

let cachedApp: express.Express | null = null;

function getApp(): express.Express {
  if (!cachedApp) {
    cachedApp = createApiApp();
  }
  return cachedApp;
}

/**
 * Reconstructs the original /api/... request path when Vercel rewrites /api/(.*) -> /api/index?__path=$1,
 * while preserving original query parameters cleanly.
 */
export function normalizeVercelApiUrl(rawUrl?: string): string {
  const input = rawUrl && rawUrl.startsWith('/') ? rawUrl : '/api/health';
  const parsed = new URL(input, 'http://localhost');
  const subPath = parsed.searchParams.get('__path');

  if (parsed.pathname === '/api/index' || parsed.pathname === '/api') {
    parsed.searchParams.delete('__path');
    const cleanSub = (subPath || '').replace(/^\/+/, '');
    parsed.pathname = cleanSub ? `/api/${cleanSub}` : '/api/health';
  } else if (subPath !== null) {
    parsed.searchParams.delete('__path');
  }

  return `${parsed.pathname}${parsed.search}`;
}

export default function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse,
): void {
  req.url = normalizeVercelApiUrl(req.url);
  const app = getApp();
  app(req as unknown as express.Request, res as unknown as express.Response);
}
