import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiApp } from './server/app.ts';
import { SERVER_CONFIG } from './server/config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = createApiApp();
  const server = http.createServer(app);

  if (SERVER_CONFIG.nodeEnv !== 'production') {
    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
        },
        appType: 'spa',
      }),
    );

    vitePromise.catch((err) => {
      console.error('Failed to initialize Vite middleware:', err);
      process.exit(1);
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(SERVER_CONFIG.port, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        severity: 'INFO',
        timestamp: new Date().toISOString(),
        message: `EduZone Linguaflow shared API server listening on http://0.0.0.0:${SERVER_CONFIG.port}`,
        environment: SERVER_CONFIG.nodeEnv,
      }),
    );
  });

  const shutdown = (signal: string) => {
    console.log(
      JSON.stringify({
        severity: 'INFO',
        timestamp: new Date().toISOString(),
        message: `Received ${signal}, shutting down gracefully...`,
      }),
    );
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start EduZone Linguaflow server:', err);
  process.exit(1);
});
