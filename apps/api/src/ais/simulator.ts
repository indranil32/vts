// Traffic simulator: synthetic vessels following realistic routes in the VTS area, driven by PCS port calls when
// the PCS is connected (inbound with/without permit, at berth, departing) plus background traffic (passing ships,
// pilot boat, tug, fishing vessel, an anchored vessel that may drag). Positions are emitted as genuine AIVDM
// sentences and go through the same decoder as a live AIS feed.
import { AisDecoder, encodePosition, encodeStatic, distanceNm, bearingDeg, destination, polygonCentroid, type LatLon } from '@vts/shared';
import { pool, many, getSetting } from '../core/db.js';
import { config } from '../core/config.js';
import { handleLine, sourceState } from './sources.js';

interface World {
  entry: LatLon; exit: LatLon; pilot: LatLon; fairwayIn: LatLon[]; anchorages: LatLon[];
  laneA: LatLon; laneB: LatLon; harbour: LatLon; fishing: LatLon[];
}
interface Leg { to: LatLon; speed: number }
interface Agent {
  mmsi: string; imo?: string; name: string; callSign: string; shipType: number; length: number; beam: number; draught: number;
  pos: LatLon; sog: number; cog: number; legs: Leg[]; nav: number; mode: string; callId?: string; berth?: LatLon; waitUntil?: number;
  dragging?: boolean; lastStatic?: number; done?: boolean; toBerth?: boolean;
}

const agents = new Map<string, Agent>();
const decoder = new AisDecoder();
let world: World | null = null;
let berths = new Map<string, LatLon>();
let seq = 0;
let lastTick = Date.now();
let lastSpawn = 0;
let transitSeq = 0;

const PERMITTED = ['ARRIVAL_CLEARED', 'ARRIVED'];

async function loadWorld() {
  world = await getSetting<World | null>('sim_world', null);
  const bz = await many(pool, `SELECT name, pcs_berth_code, polygon FROM zones WHERE type='BERTH' AND active`);
  berths = new Map(bz.map((z) => [z.pcs_berth_code ?? z.name, polygonCentroid(z.polygon)]));
}

function inboundLegs(a: Agent, toBerth: boolean): Leg[] {
  const w = world!;
  const legs: Leg[] = [{ to: w.pilot, speed: 10 }];
  if (toBerth && a.berth) return [...legs, ...w.fairwayIn.map((p) => ({ to: p, speed: 7 })), { to: a.berth, speed: 2 }];
  const anch = w.anchorages[Number(a.mmsi.slice(-1)) % w.anchorages.length];
  return [...legs, { to: destination(anch, (Number(a.mmsi.slice(-2)) * 37) % 360, 0.25), speed: 6 }];
}
function outboundLegs(): Leg[] {
  const w = world!;
  return [...[...w.fairwayIn].reverse().map((p) => ({ to: p, speed: 7 })), { to: w.pilot, speed: 9 }, { to: w.exit, speed: 13 }];
}

function spawn(a: Partial<Agent> & { mmsi: string; name: string; pos: LatLon }): Agent {
  const full: Agent = { imo: undefined, callSign: `ZZ${a.mmsi.slice(-4)}`, shipType: 70, length: 180, beam: 28, draught: 9, sog: 0, cog: 0, legs: [], nav: 0, mode: 'IDLE', ...a } as Agent;
  agents.set(full.mmsi, full);
  return full;
}

/** Bring agents in line with the PCS: one agent per active call that has an MMSI. */
async function syncWithPcs() {
  const calls = await many(pool, `SELECT c.*, v.length, v.beam, v.draught FROM pcs_calls c LEFT JOIN vessels v ON v.mmsi=c.mmsi WHERE c.mmsi IS NOT NULL`);
  for (const c of calls) {
    let a = agents.get(c.mmsi);
    const berth = c.berth_code ? berths.get(c.berth_code) : undefined;
    const base = { mmsi: c.mmsi, imo: c.imo?.trim(), name: c.vessel_name, length: Number(c.length ?? 200), beam: Number(c.beam ?? 30), draught: Number(c.draught ?? 10), callId: c.id, berth };
    if (['DEPARTED', 'CANCELLED'].includes(c.status)) { if (a && a.mode !== 'OUTBOUND') agents.delete(c.mmsi); continue; }
    const eta = c.eta ? new Date(c.eta).getTime() : 0;
    if (!a) {
      if (['BERTHED', 'DEPARTURE_REQUESTED', 'DEPARTURE_CLEARED'].includes(c.status) && berth) a = spawn({ ...base, pos: berth, mode: 'BERTHED', nav: 5 });
      else if (c.status === 'ARRIVED') a = spawn({ ...base, pos: berth ? world!.fairwayIn[0] : world!.anchorages[0], mode: 'INBOUND', legs: [] });
      else if (['BERTH_ALLOCATED', 'PRE_ARRIVAL_SUBMITTED', 'ARRIVAL_CLEARED'].includes(c.status) && eta < Date.now() + 2 * 864e5)
        a = spawn({ ...base, pos: destination(world!.entry, (Number(c.mmsi.slice(-3)) * 13) % 60 - 30, 1.5), mode: 'APPROACH', sog: 12 });
      else continue;
      if (a.mode === 'APPROACH') { a.toBerth = PERMITTED.includes(c.status) && !!berth; a.legs = inboundLegs(a, a.toBerth); }
      if (a.mode === 'INBOUND') a.legs = berth ? [{ to: berth, speed: 3 }] : [];
    }
    a.berth = berth ?? a.berth;
    // permit granted while still approaching → re-route straight to the berth
    if (a.mode === 'APPROACH' && PERMITTED.includes(c.status) && a.berth && !a.toBerth) {
      a.toBerth = true;
      const fair = world!.fairwayIn.map((p) => ({ to: p, speed: 7 }));
      a.legs = [...(a.pos[1] > world!.pilot[1] ? [{ to: world!.pilot, speed: 10 }] : []), ...fair, { to: a.berth, speed: 2 }];
    }
    // waiting at anchorage → permit granted → proceed to berth
    if (a.mode === 'ANCHORED' && PERMITTED.includes(c.status) && a.berth) { a.mode = 'INBOUND'; a.nav = 0; a.legs = [{ to: world!.pilot, speed: 6 }, ...world!.fairwayIn.map((p) => ({ to: p, speed: 7 })), { to: a.berth, speed: 2 }]; }
    // cleared to depart
    if (a.mode === 'BERTHED' && c.status === 'DEPARTURE_CLEARED') { a.mode = 'OUTBOUND'; a.nav = 0; a.legs = outboundLegs(); }
  }
}

function backgroundTraffic() {
  const w = world!;
  if (!agents.has('999000101')) spawn({ mmsi: '999000101', name: 'PILOT ONE', shipType: 50, length: 18, beam: 5, draught: 1.5, pos: w.harbour, mode: 'PILOT' });
  if (!agents.has('999000102')) spawn({ mmsi: '999000102', name: 'HARBOUR TUG 2', shipType: 52, length: 30, beam: 11, draught: 4, pos: w.harbour, mode: 'TUG' });
  if (!agents.has('999000103')) spawn({ mmsi: '999000103', name: 'SEA HARVEST', shipType: 30, length: 24, beam: 7, draught: 3, pos: w.fishing[0], mode: 'FISHING' });
  if (!agents.has('999000104')) spawn({ mmsi: '999000104', name: 'WAITING STAR', imo: '9161234', shipType: 80, length: 183, beam: 32, draught: 11, pos: destination(w.anchorages[0], 200, 0.3), mode: 'ANCHORED', nav: 1 });
  // passing ships through the traffic lane, one at a time each way
  if (Date.now() - lastSpawn > 20 * 60_000 / config.simTimeFactor) {
    lastSpawn = Date.now();
    const n = transitSeq++;
    const north = n % 2 === 0;
    const id = `99920${String(n % 1000).padStart(4, '0')}`;
    const names = ['NORTHERN LIGHT', 'OCEAN BREEZE', 'CAPE AURORA', 'BLUE HORIZON', 'SILVER WAVE', 'ATLANTIC DAWN', 'POLAR TRADER', 'CORAL SEAS'];
    if (!agents.has(id)) spawn({ mmsi: id, name: names[n % names.length], shipType: north ? 70 : 80, length: 200, beam: 32, draught: 10, pos: north ? w.laneA : w.laneB, mode: 'TRANSIT', sog: 14, legs: [{ to: north ? w.laneB : w.laneA, speed: 14 }] });
  }
}

function plan(a: Agent) {
  const w = world!;
  if (a.legs.length) return;
  switch (a.mode) {
    case 'PILOT': { const gate = w.fairwayIn[w.fairwayIn.length - 1]; a.legs = a.pos[1] < w.pilot[1] - 0.01 ? [{ to: gate, speed: 5 }, { to: w.pilot, speed: 16 }] : [{ to: gate, speed: 16 }, { to: w.harbour, speed: 5 }]; } a.waitUntil = Date.now() + 5 * 60_000 / config.simTimeFactor; break;
    case 'TUG': { const ps = [...berths.values()]; a.legs = [{ to: ps[Math.floor(Math.random() * ps.length)] ?? w.harbour, speed: 6 }]; a.waitUntil = Date.now() + 10 * 60_000 / config.simTimeFactor; break; }
    case 'FISHING': { const i = Math.floor(Math.random() * w.fishing.length); a.legs = [{ to: w.fishing[i], speed: 5 }]; a.waitUntil = Date.now() + 8 * 60_000 / config.simTimeFactor; break; }
    case 'APPROACH': a.mode = 'ANCHORED'; a.nav = 1; break;      // arrived at anchorage (no permit yet)
    case 'INBOUND': if (a.berth && distanceNm(a.pos, a.berth) < 0.05) { a.mode = 'BERTHED'; a.nav = 5; } break;
    case 'OUTBOUND': case 'TRANSIT': a.done = true; break;
    case 'ANCHORED':
      // occasional anchor drag for the background anchored vessel
      if (a.mmsi === '999000104' && !a.dragging && Math.random() < 0.002) a.dragging = true;
      if (a.dragging) { a.pos = destination(a.pos, 135, 0.004 * config.simTimeFactor / 6); a.sog = 0.8; a.cog = 135; if (Math.random() < 0.01) { a.dragging = false; a.legs = [{ to: destination(w.anchorages[0], 200, 0.3), speed: 3 }]; } }
      else { a.sog = 0; }
      break;
  }
}

function move(a: Agent, hours: number) {
  if (a.waitUntil && Date.now() < a.waitUntil) { a.sog = 0; return; }
  const leg = a.legs[0];
  if (!leg) { if (!a.dragging) a.sog = 0; return; }
  const d = distanceNm(a.pos, leg.to);
  // slow down ahead of a slower next leg (harbour limits, berthing)
  const next = a.legs[1];
  const target = next && next.speed < leg.speed && d < Math.max(0.3, a.sog * hours * 4) ? next.speed : leg.speed;
  a.sog = a.sog + Math.max(-1.5, Math.min(1.5, target - a.sog)); // gentle accel/decel
  const step = a.sog * hours;
  a.cog = bearingDeg(a.pos, leg.to);
  if (step >= d) { a.pos = leg.to; a.legs.shift(); } else a.pos = destination(a.pos, a.cog, step);
}

export async function startSimulator() {
  await loadWorld();
  if (!world) { sourceState.detail = 'no sim_world configured'; return; }
  sourceState.connected = true;
  sourceState.detail = `simulator ×${config.simTimeFactor}`;
  let s = 0;
  setInterval(async () => {
    try {
      const now = Date.now();
      const hours = ((now - lastTick) / 3.6e6) * config.simTimeFactor;
      lastTick = now;
      if (s++ % 10 === 0) { await loadWorld(); await syncWithPcs(); }
      backgroundTraffic();
      for (const a of agents.values()) {
        plan(a);
        move(a, hours);
        if (a.done) { agents.delete(a.mmsi); continue; }
        if (!a.lastStatic || now - a.lastStatic > 120_000) {
          a.lastStatic = now;
          for (const line of encodeStatic({ mmsi: a.mmsi, imo: a.imo, callSign: a.callSign, name: a.name, shipType: a.shipType, length: a.length, beam: a.beam, draught: a.draught, destination: 'ZZALP' }, (seq++ % 9) + 1)) await handleLine(line, decoder, 'SIMULATOR');
        }
        await handleLine(encodePosition({ mmsi: a.mmsi, lat: a.pos[0], lon: a.pos[1], sog: Math.round(a.sog * 10) / 10, cog: Math.round(a.cog * 10) / 10 % 360, heading: Math.round(a.cog) % 360, navStatus: a.nav }), decoder, 'SIMULATOR');
      }
    } catch { /* keep simulating */ }
  }, 3000).unref();
}

export const simAgents = () => agents.size;
