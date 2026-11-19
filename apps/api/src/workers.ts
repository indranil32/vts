// Background loops: AIS input, traffic engine, PCS synchronisation and housekeeping.
import type { FastifyBaseLogger } from 'fastify';
import { config } from './core/config.js';
import { tick, pruneHistory } from './engine.js';
import { syncCalls, dispatchMovements, pushAis, pcsEnabled } from './pcs.js';
import { startSimulator } from './ais/simulator.js';
import { startNmeaTcp, startNmeaUdp, startProvider, sourceState } from './ais/sources.js';
import { log } from './core/db.js';

function every(ms: number, name: string, fn: () => Promise<unknown>, logger: FastifyBaseLogger) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { logger.warn({ err: e }, `${name} failed`); } finally { busy = false; }
  };
  run();
  setInterval(run, ms).unref();
}

export async function startWorkers(logger: FastifyBaseLogger) {
  if (pcsEnabled()) {
    await syncCalls().catch(() => {});
    logger.info(`PCS integration enabled → ${config.pcsUrl}`);
  } else logger.info('PCS integration disabled (PCS_URL / PCS_API_KEY not set)');

  switch (config.aisSource) {
    case 'SIMULATOR': await startSimulator(); break;
    case 'NMEA_TCP': startNmeaTcp(); break;
    case 'NMEA_UDP': startNmeaUdp(); break;
    case 'PROVIDER': startProvider(); break;
    default: sourceState.detail = 'no AIS source';
  }
  await log('EVENT', `VTS system started — AIS source ${config.aisSource}${pcsEnabled() ? ', PCS connected' : ''}`);

  every(3_000, 'engine', tick, logger);
  every(30_000, 'pcs-sync', syncCalls, logger);
  every(5_000, 'pcs-outbox', dispatchMovements, logger);
  every(15_000, 'pcs-ais', pushAis, logger);
  every(10 * 60_000, 'prune', pruneHistory, logger);
}
