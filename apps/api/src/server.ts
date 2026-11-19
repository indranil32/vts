import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './core/config.js';
import api from './modules/api.js';

/** Startup state of the process-level server (main.ts). Servers built without `gated` (tests) ignore it. */
export const lifecycle = { ready: true };

export async function buildApp(opts: { logger?: boolean; gated?: boolean } = {}) {
  const gated = !!opts.gated;
  const app = Fastify({ logger: opts.logger === false ? false : { level: config.logLevel }, bodyLimit: 5 * 1024 * 1024 });

  // Keep the raw body for webhook signature verification
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch (e: any) { e.statusCode = 400; done(e, undefined); }
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '12h' } });
  await app.register(rateLimit, { max: 1200, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: { title: 'VTS API — Vessel Traffic Service', version: '0.1.0', description: 'VTS operator system API. Authenticate with `Authorization: Bearer <JWT>` from /api/auth/login.' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.get('/health', async () => ({ status: !gated || lifecycle.ready ? 'ok' : 'starting', service: 'vts-api', version: process.env.APP_VERSION ?? 'dev', time: new Date().toISOString() }));
  app.get('/ready', async (_req, reply) => reply.status(!gated || lifecycle.ready ? 200 : 503).send({ ready: !gated || lifecycle.ready }));

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/docs')) return;
    if (gated && !lifecycle.ready) return reply.status(503).send({ error: 'Starting up' });
    if ((req.routeOptions.config as any)?.public) return;
    try { await req.jwtVerify(); } catch { return reply.status(401).send({ error: 'Not authenticated' }); }
  });

  await app.register(api, { prefix: '/api' });

  const webDist = process.env.WEB_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'Not found' });
    });
  }
  return app;
}
