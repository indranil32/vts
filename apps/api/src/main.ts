// Process entry point: listen first (liveness), then migrate + seed; /ready is 503 until done.
import { buildApp, lifecycle } from './server.js';
import { config } from './core/config.js';
import { startWorkers } from './workers.js';

lifecycle.ready = false;
const app = await buildApp({ gated: true });
await app.listen({ port: config.port, host: '0.0.0.0' });
try {
  if (process.env.MIGRATE_ON_START !== 'false') {
    const { migrate } = await import('./db/migrate.js');
    await migrate((m) => app.log.info(m));
  }
  if ((process.env.SEED_DEMO_DATA ?? 'true').toLowerCase() === 'true') {
    const { seed } = await import('./db/seed.js');
    await seed({ log: (m) => app.log.info(m) });
  }
  lifecycle.ready = true;
  app.log.info('VTS ready');
  if (config.workers) await startWorkers(app.log);
} catch (e) {
  app.log.error(e, 'startup failed');
  process.exit(1);
}
