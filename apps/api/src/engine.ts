// Traffic engine: ingests AIS reports, maintains the traffic image, evaluates VTS rules and drives PCS movement reports.
import {
  distanceNm, bearingDeg, pointInPolygon, segmentsIntersect, cpaTcpa, polygonCentroid, SMALL_CRAFT,
  type AisReport, type LatLon,
} from '@vts/shared';
import { pool, many, one, log, getSetting } from './core/db.js';
import { callForMmsi, queueMovement, pcsEnabled } from './pcs.js';
import { config } from './core/config.js';

export interface Thresholds { cpaNm: number; tcpaMin: number; aisLostMin: number; anchorRadiusNm: number; cpaRangeNm: number; unknownVesselMinLength: number }
export const DEFAULT_THRESHOLDS: Thresholds = { cpaNm: 0.3, tcpaMin: 10, aisLostMin: 3, anchorRadiusNm: 0.12, cpaRangeNm: 3, unknownVesselMinLength: 60 };

const lastTrack = new Map<string, { at: number; cog: number }>();
const prevPos = new Map<string, LatLon>();
let zoneCache: { at: number; zones: any[]; points: any[]; ref: LatLon | null } = { at: 0, zones: [], points: [], ref: null };

async function zones() {
  if (Date.now() - zoneCache.at > 30_000) {
    const z = await many(pool, 'SELECT * FROM zones WHERE active');
    const points = await many(pool, 'SELECT * FROM reporting_points WHERE active');
    const ref = await getSetting<LatLon | null>('port_reference', null);
    zoneCache = { at: Date.now(), zones: z, points, ref };
  }
  return zoneCache;
}
export const invalidateZones = () => { zoneCache.at = 0; };

// ---------------------------------------------------------------- ingestion
export async function ingest(r: AisReport, source: string) {
  if (!/^\d{9}$/.test(r.mmsi)) return;
  if (r.name || r.imo || r.callSign || r.shipType != null || r.length) {
    await pool.query(
      `INSERT INTO vessels (mmsi, imo, name, call_sign, ship_type, ship_type_text, length, beam, draught, destination, ais_class, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (mmsi) DO UPDATE SET imo=coalesce(EXCLUDED.imo, vessels.imo), name=coalesce(EXCLUDED.name, vessels.name), call_sign=coalesce(EXCLUDED.call_sign, vessels.call_sign),
         ship_type=coalesce(EXCLUDED.ship_type, vessels.ship_type), ship_type_text=coalesce(EXCLUDED.ship_type_text, vessels.ship_type_text),
         length=coalesce(EXCLUDED.length, vessels.length), beam=coalesce(EXCLUDED.beam, vessels.beam), draught=coalesce(EXCLUDED.draught, vessels.draught),
         destination=coalesce(EXCLUDED.destination, vessels.destination), ais_class=EXCLUDED.ais_class, updated_at=now()`,
      [r.mmsi, r.imo ?? null, r.name || null, r.callSign || null, r.shipType ?? null, r.shipTypeText ?? null, r.length ?? null, r.beam ?? null, r.draught ?? null, r.destination || null, r.classB ? 'B' : 'A'],
    );
  }
  if (r.lat == null || r.lon == null) return;
  const now = new Date();
  await pool.query(
    `INSERT INTO targets (mmsi, lat, lon, sog, cog, heading, rot, nav_status, source, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (mmsi) DO UPDATE SET lat=EXCLUDED.lat, lon=EXCLUDED.lon, sog=EXCLUDED.sog, cog=EXCLUDED.cog, heading=EXCLUDED.heading, rot=EXCLUDED.rot,
       nav_status=coalesce(EXCLUDED.nav_status, targets.nav_status), source=EXCLUDED.source, at=EXCLUDED.at`,
    [r.mmsi, r.lat, r.lon, r.sog ?? null, r.cog ?? null, r.heading ?? null, r.rot ?? null, r.navStatus ?? null, source, now],
  );
  // Thinned track: every 30 s, or on a course change > 10°
  const lt = lastTrack.get(r.mmsi);
  const cog = r.cog ?? 0;
  if (!lt || Date.now() - lt.at > 30_000 || Math.abs(((cog - lt.cog + 540) % 360) - 180) > 10) {
    lastTrack.set(r.mmsi, { at: Date.now(), cog });
    await pool.query('INSERT INTO track_points (mmsi, lat, lon, sog, cog, heading, at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [r.mmsi, r.lat, r.lon, r.sog ?? null, r.cog ?? null, r.heading ?? null, now]);
  }
}

// ---------------------------------------------------------------- alerts
const activeKeys = new Set<string>();
export async function raise(type: string, severity: 'INFO' | 'WARNING' | 'ALARM', key: string, message: string, mmsi?: string | null, mmsi2?: string | null, data?: unknown) {
  activeKeys.add(key);
  const r = await pool.query(
    `INSERT INTO alerts (type, severity, key, mmsi, mmsi2, message, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (key) WHERE status IN ('OPEN','ACKNOWLEDGED') DO UPDATE SET message=EXCLUDED.message, data=EXCLUDED.data, last_seen_at=now(), severity=EXCLUDED.severity
     RETURNING (xmax = 0) AS inserted`,
    [type, severity, key, mmsi ?? null, mmsi2 ?? null, message, data ? JSON.stringify(data) : null],
  );
  if (r.rows[0]?.inserted) await log('EVENT', `${severity} ${type}: ${message}`, mmsi);
}

// ---------------------------------------------------------------- evaluation tick
export async function tick() {
  const { zones: zs, points, ref } = await zones();
  const th = { ...DEFAULT_THRESHOLDS, ...(await getSetting<Partial<Thresholds>>('thresholds', {})) };
  activeKeys.clear();
  const rows = await many(pool, `SELECT t.*, v.name, v.imo, v.ship_type_text, v.length, v.draught FROM targets t LEFT JOIN vessels v ON v.mmsi=t.mmsi`);
  const now = Date.now();
  const moving: any[] = [];

  for (const t of rows) {
    const pos: LatLon = [t.lat, t.lon];
    const ageMin = (now - new Date(t.at).getTime()) / 6e4;
    const label = t.name ? `${t.name} (${t.mmsi})` : `MMSI ${t.mmsi}`;
    const small = SMALL_CRAFT.includes(t.ship_type_text ?? '');
    const inZones = zs.filter((z) => pointInPolygon(pos, z.polygon));
    const names = inZones.map((z) => z.type === 'VTS_AREA' ? 'VTS_AREA' : z.name);
    const inArea = inZones.some((z) => z.type === 'VTS_AREA');
    const prevNames: string[] = t.zones ?? [];

    // Drop targets long gone
    if (ageMin > 30) { await pool.query('DELETE FROM targets WHERE mmsi=$1', [t.mmsi]); prevPos.delete(t.mmsi); continue; }

    // Zone entry / exit events
    for (const n of names) if (!prevNames.includes(n)) await log('EVENT', `${label} entered ${n === 'VTS_AREA' ? 'the VTS area' : n}`, t.mmsi);
    for (const n of prevNames) if (!names.includes(n)) await log('EVENT', `${label} left ${n === 'VTS_AREA' ? 'the VTS area' : n}`, t.mmsi);

    // Reporting-line crossings
    const pp = prevPos.get(t.mmsi);
    if (pp && (pp[0] !== pos[0] || pp[1] !== pos[1])) {
      for (const rp of points) if (segmentsIntersect(pp, pos, rp.line[0], rp.line[1])) await log('EVENT', `${label} passed reporting point ${rp.name} at ${t.sog ?? '?'} kn`, t.mmsi);
    }
    prevPos.set(t.mmsi, pos);

    // Traffic state
    const sog = Number(t.sog ?? 0);
    const berth = inZones.find((z) => z.type === 'BERTH');
    const anch = inZones.find((z) => z.type === 'ANCHORAGE');
    const fairway = inZones.find((z) => z.type === 'FAIRWAY');
    let status: string;
    if (!inArea) status = ['IN_AREA', 'INBOUND', 'OUTBOUND', 'AT_ANCHOR', 'BERTHED'].includes(t.traffic_status) || t.traffic_status === 'LEFT_AREA' ? 'LEFT_AREA' : 'APPROACHING';
    else if (berth && sog < 0.5) status = 'BERTHED';
    else if (anch && (sog < 1 || t.nav_status === 'AT_ANCHOR')) status = 'AT_ANCHOR';
    else if (ref && sog >= 0.5) {
      const towardPort = Math.abs(((bearingDeg(pos, ref) - Number(t.cog ?? 0) + 540) % 360) - 180) < 90;
      status = towardPort ? 'INBOUND' : 'OUTBOUND';
    } else status = 'IN_AREA';
    let anchor: LatLon | null = t.anchor_lat != null ? [t.anchor_lat, t.anchor_lon] : null;
    if (status === 'AT_ANCHOR' && !anchor && sog < 0.5) anchor = pos;
    if (status !== 'AT_ANCHOR' && !(anchor && anch)) anchor = null;
    if (status !== t.traffic_status && t.traffic_status) await log('EVENT', `${label}: ${t.traffic_status} → ${status}`, t.mmsi);
    await pool.query('UPDATE targets SET zones=$2, traffic_status=$3, anchor_lat=$4, anchor_lon=$5 WHERE mmsi=$1', [t.mmsi, names, status, anchor?.[0] ?? null, anchor?.[1] ?? null]);
    if (!inArea) continue;

    // ---- rules
    if (ageMin > th.aisLostMin) await raise('AIS_LOST', 'WARNING', `AIS_LOST:${t.mmsi}`, `${label}: no AIS for ${Math.round(ageMin)} min`, t.mmsi);
    for (const z of inZones) {
      if (z.max_speed && sog > Number(z.max_speed) + 0.5) await raise('SPEED', 'WARNING', `SPEED:${t.mmsi}`, `${label} at ${sog} kn in ${z.name} (limit ${z.max_speed} kn)`, t.mmsi, null, { zone: z.name, sog });
      if (z.type === 'RESTRICTED' && t.ship_type_text !== 'LAW_ENFORCEMENT') await raise('RESTRICTED_AREA', 'ALARM', `RESTRICTED:${t.mmsi}`, `${label} inside restricted area ${z.name}`, t.mmsi, null, { zone: z.name });
      if (z.min_depth && t.draught && Number(t.draught) > Number(z.min_depth) - 0.5) await raise('GROUNDING_RISK', 'WARNING', `GROUNDING:${t.mmsi}:${z.id}`, `${label} draught ${t.draught} m vs charted ${z.min_depth} m in ${z.name}`, t.mmsi);
    }
    if (anchor && anch) {
      const d = distanceNm(anchor, pos);
      if (d > th.anchorRadiusNm && sog < 3) await raise('ANCHOR_DRAG', 'ALARM', `ANCHOR_DRAG:${t.mmsi}`, `${label} ${(d * 1852).toFixed(0)} m from anchor position — possible dragging`, t.mmsi, null, { distanceM: Math.round(d * 1852) });
    }
    if (sog > 0.5) moving.push({ ...t, pos });

    // PCS-aware rules and movement reports
    if (!small) {
      const pcs = await callForMmsi(t.mmsi);
      const portWaters = inZones.find((z) => ['FAIRWAY', 'ANCHORAGE', 'BERTH', 'PILOT_BOARDING', 'PRECAUTIONARY'].includes(z.type));
      if (!pcs && pcsEnabled() && portWaters && Number(t.length ?? 0) >= th.unknownVesselMinLength) await raise('UNKNOWN_VESSEL', 'WARNING', `UNKNOWN:${t.mmsi}`, `${label} in ${portWaters.name} with no port call in the PCS`, t.mmsi);
      if (pcs) {
        const permitted = ['ARRIVAL_CLEARED', 'ARRIVED', 'BERTHED', 'DEPARTURE_REQUESTED', 'DEPARTURE_CLEARED', 'DEPARTED'].includes(pcs.status);
        if (!permitted && (fairway || berth) && status === 'INBOUND') await raise('NO_ENTRY_PERMIT', 'ALARM', `NO_PERMIT:${t.mmsi}`, `${label} entering ${fairway?.name ?? berth?.name} without a port entry permit (PCS ${pcs.call_no}: ${pcs.status})`, t.mmsi, null, { callNo: pcs.call_no });
        if (['BERTHED', 'DEPARTURE_REQUESTED'].includes(pcs.status) && sog > 1 && !berth) await raise('NO_DEPARTURE_CLEARANCE', 'ALARM', `NO_DEPARTURE:${t.mmsi}`, `${label} under way without departure clearance (PCS ${pcs.call_no}: ${pcs.status})`, t.mmsi, null, { callNo: pcs.call_no });
        if (config.pcsAutoMovements) {
          if (pcs.status === 'ARRIVAL_CLEARED' && !pcs.ata) await queueMovement(pcs.id, 'arrived', new Date(t.at), 'vessel inside the VTS area', t.mmsi);
          if (pcs.status === 'ARRIVED' && status === 'BERTHED') await queueMovement(pcs.id, 'berthed', new Date(t.at), `stopped at ${berth?.name}`, t.mmsi);
        }
      }
    }
  }

  // Departures: cleared vessels that have left the area
  if (config.pcsAutoMovements && pcsEnabled()) {
    const gone = await many(pool, `SELECT c.id, c.mmsi, t.at FROM pcs_calls c JOIN targets t ON t.mmsi=c.mmsi WHERE c.status='DEPARTURE_CLEARED' AND t.traffic_status='LEFT_AREA'`);
    for (const g of gone) await queueMovement(g.id, 'departed', new Date(g.at), 'vessel left the VTS area', g.mmsi);
  }

  // Close-quarters situations (pairs of moving targets)
  for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) {
    const a = moving[i], b = moving[j];
    if (distanceNm(a.pos, b.pos) > th.cpaRangeNm) continue;
    const r = cpaTcpa({ pos: a.pos, sog: Number(a.sog), cog: Number(a.cog ?? 0) }, { pos: b.pos, sog: Number(b.sog), cog: Number(b.cog ?? 0) });
    if (r.cpaNm < th.cpaNm && r.tcpaMin > 0 && r.tcpaMin < th.tcpaMin) {
      const [x, y] = [a.mmsi, b.mmsi].sort();
      await raise('CPA', 'ALARM', `CPA:${x}:${y}`, `Close quarters: ${a.name ?? a.mmsi} / ${b.name ?? b.mmsi} — CPA ${(r.cpaNm * 1852).toFixed(0)} m in ${r.tcpaMin.toFixed(1)} min`, x, y, { cpaNm: r.cpaNm, tcpaMin: r.tcpaMin });
    }
  }

  // Auto-clear alerts whose condition no longer holds
  const open = await many(pool, `SELECT id, key, type, mmsi FROM alerts WHERE status IN ('OPEN','ACKNOWLEDGED')`);
  for (const a of open) if (!activeKeys.has(a.key)) {
    await pool.query(`UPDATE alerts SET status='AUTO_CLEARED', closed_at=now() WHERE id=$1`, [a.id]);
  }
}

export async function pruneHistory() {
  await pool.query(`DELETE FROM track_points WHERE at < now() - interval '7 days'`);
  await pool.query(`UPDATE clearances SET status='EXPIRED' WHERE status='ACTIVE' AND valid_until < now()`);
}

export function berthPosition(zone: any): LatLon { return polygonCentroid(zone.polygon); }
void one;
