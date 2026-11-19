// Demo VTS centre for "Demo Port Alpha" (PCS port ZZALP). Geography sits in an empty patch of ocean near 0°N 0°E,
// matching the PCS demo berth coordinates so the two systems show the same port.
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { circle, type LatLon } from '@vts/shared';
import { pool, one } from '../core/db.js';

export const SEED_VERSION = '2';

const box = (lat1: number, lon1: number, lat2: number, lon2: number): LatLon[] => [[lat1, lon1], [lat1, lon2], [lat2, lon2], [lat2, lon1]];
const berthBox = (lat: number, lon: number): LatLon[] => box(lat - 0.0012, lon - 0.0022, lat + 0.0012, lon + 0.0022);

/** PCS berths of Demo Port Alpha (code, name, lat, lon). */
const BERTHS: [string, string, number, number][] = [
  ['A1', 'Berth A1 — Container Terminal 1', 0.006, 0.016],
  ['A2', 'Berth A2 — Container Terminal 1', 0.002, 0.018],
  ['N1', 'Berth N1 — Container Terminal 2', 0.032, 0.026],
  ['N2', 'Berth N2 — Container Terminal 2', 0.028, 0.027],
  ['B1', 'Berth B1 — Bulk Terminal', 0.013, 0.005],
  ['BG1', 'Berth BG1 — Barge Terminal', -0.003, -0.006],
  ['BG2', 'Berth BG2 — Barge Terminal', -0.005, -0.008],
];

const ZONES: { name: string; type: string; polygon: LatLon[]; maxSpeed?: number; minDepth?: number; berth?: string }[] = [
  { name: 'VTS Area Demo Port Alpha', type: 'VTS_AREA', polygon: box(-0.12, -0.02, 0.16, 0.25) },
  { name: 'Mainland', type: 'LAND', polygon: [[0.2, -0.2], [0.2, -0.012], [-0.16, -0.012], [-0.16, -0.2]] },
  { name: 'North Pier', type: 'LAND', polygon: box(0.0295, -0.012, 0.0305, 0.025) },
  { name: 'Container Pier', type: 'LAND', polygon: box(0.0033, -0.012, 0.0047, 0.019) },
  { name: 'Bulk Quay', type: 'LAND', polygon: box(0.0105, -0.012, 0.0115, 0.008) },
  { name: 'Inner Harbour', type: 'PRECAUTIONARY', polygon: box(-0.012, -0.012, 0.04, 0.034), maxSpeed: 6 },
  { name: 'Main Fairway', type: 'FAIRWAY', polygon: box(0.004, 0.034, 0.026, 0.145), maxSpeed: 10 },
  { name: 'Anchorage A (North)', type: 'ANCHORAGE', polygon: box(0.06, 0.1, 0.09, 0.14) },
  { name: 'Anchorage B (South)', type: 'ANCHORAGE', polygon: box(-0.07, 0.09, -0.04, 0.13) },
  { name: 'Pilot Boarding Ground', type: 'PILOT_BOARDING', polygon: circle([0.015, 0.15], 0.5, 16) },
  { name: 'Restricted Area R1 (cable field)', type: 'RESTRICTED', polygon: box(-0.03, 0.04, -0.015, 0.07) },
  { name: 'Shoal Patch (charted 8.0 m)', type: 'PRECAUTIONARY', polygon: box(0.036, 0.05, 0.05, 0.08), minDepth: 8 },
  ...BERTHS.map(([code, name, lat, lon]) => ({ name, type: 'BERTH', polygon: berthBox(lat, lon), berth: code })),
];

const REPORTING_POINTS: { name: string; line: [LatLon, LatLon] }[] = [
  { name: 'RP1 Outer limit', line: [[-0.06, 0.2], [0.1, 0.2]] },
  { name: 'RP2 Pilot station', line: [[0.0, 0.14], [0.03, 0.14]] },
  { name: 'RP3 Harbour entrance', line: [[0.0, 0.034], [0.034, 0.034]] },
];

const SETTINGS: Record<string, unknown> = {
  centre: { name: 'Demo Port Alpha VTS', portCode: 'ZZALP', vhf: 'VHF Ch 12 (working) / Ch 16 (distress)', center: [0.02, 0.115], zoom: 12 },
  port_reference: [0.015, 0.02],
  sim_world: {
    entry: [0.015, 0.3], exit: [0.03, 0.3], pilot: [0.015, 0.15],
    fairwayIn: [[0.015, 0.12], [0.015, 0.06], [0.015, 0.036]],
    anchorages: [[0.075, 0.12], [-0.055, 0.11]],
    laneA: [-0.17, 0.22], laneB: [0.21, 0.225],
    harbour: [0.02, 0.0],
    fishing: [[-0.03, 0.16], [-0.06, 0.18], [-0.02, 0.2], [-0.025, 0.06]],
  },
};

export const DEMO_USERS: [string, string, string[]][] = [
  ['admin@vts.demo', 'VTS Administrator', ['VTS_ADMIN']],
  ['harbour@vts.demo', 'Harbour Master', ['VTS_SUPERVISOR']],
  ['operator@vts.demo', 'VTS Operator', ['VTS_OPERATOR']],
  ['viewer@vts.demo', 'Port Viewer', ['VTS_VIEWER']],
];

export async function seed(opts: { log?: (m: string) => void; force?: boolean } = {}) {
  const log = opts.log ?? console.log;
  const state = await one(pool, 'SELECT version FROM seed_state WHERE id=1').catch(() => null);
  if (state?.version === SEED_VERSION && !opts.force) { log(`seed ${SEED_VERSION} already applied`); return; }
  const password = process.env.DEMO_PASSWORD || 'Vts-demo-2026';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Reference data is replaced; operational history (log, tracks) is kept.
    await c.query('DELETE FROM zones');
    await c.query('DELETE FROM reporting_points');
    for (const z of ZONES)
      await c.query('INSERT INTO zones (name, type, polygon, max_speed, min_depth, pcs_berth_code) VALUES ($1,$2,$3,$4,$5,$6)',
        [z.name, z.type, JSON.stringify(z.polygon), z.maxSpeed ?? null, z.minDepth ?? null, z.berth ?? null]);
    for (const p of REPORTING_POINTS) await c.query('INSERT INTO reporting_points (name, line) VALUES ($1,$2)', [p.name, JSON.stringify(p.line)]);
    for (const [k, v] of Object.entries(SETTINGS))
      await c.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, JSON.stringify(v)]);
    const hash = await bcrypt.hash(password, 10);
    for (const [email, name, roles] of DEMO_USERS)
      await c.query(`INSERT INTO users (email, name, password_hash, roles) VALUES ($1,$2,$3,$4)
        ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, roles=EXCLUDED.roles, active=true`, [email, name, hash, roles]);
    await c.query(`INSERT INTO seed_state (id, version) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version, completed_at=now()`, [SEED_VERSION]);
    await c.query('COMMIT');
    log(`seed ${SEED_VERSION} applied: ${ZONES.length} zones, ${REPORTING_POINTS.length} reporting points, ${DEMO_USERS.length} users`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  seed({ force: process.argv.includes('--force') }).then(() => pool.end(), (e) => { console.error(e); process.exit(1); });
}
