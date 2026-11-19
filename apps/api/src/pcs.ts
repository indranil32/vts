// Integration with a Port Community System (PCS) over its REST API (x-api-key) and signed webhooks.
//  PCS → VTS: vessel calls (expected arrivals, berth, entry permit, departure clearance) by polling + webhooks
//  VTS → PCS: movement reports (ATA / all fast / ATD) through a retrying outbox, and the live AIS picture
import crypto from 'node:crypto';
import { config } from './core/config.js';
import { pool, many, one, log } from './core/db.js';

export const pcsEnabled = () => !!(config.pcsUrl && config.pcsApiKey);
export const pcsState = { lastSync: null as Date | null, lastError: null as string | null, callCount: 0, lastAisPush: null as Date | null };

const ACTIVE = 'BERTH_REQUESTED,BERTH_ALLOCATED,PRE_ARRIVAL_SUBMITTED,ARRIVAL_CLEARED,ARRIVED,BERTHED,DEPARTURE_REQUESTED,DEPARTURE_CLEARED,DEPARTED,CANCELLED';

async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(`${config.pcsUrl}/api${path}`, {
    ...init,
    headers: { 'x-api-key': config.pcsApiKey, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await r.text();
  if (!r.ok) {
    let msg = body;
    try { msg = JSON.parse(body).error ?? body; } catch { /* not json */ }
    const e: any = new Error(`PCS ${init.method ?? 'GET'} ${path} → ${r.status}: ${msg}`);
    e.status = r.status;
    throw e;
  }
  return body ? JSON.parse(body) : null;
}

/** Pull active port calls from the PCS and mirror them locally. */
export async function syncCalls() {
  if (!pcsEnabled()) return;
  try {
    const from = new Date(Date.now() - 3 * 864e5).toISOString();
    const rows: any[] = await call(`/vessel-calls?status=${ACTIVE}&from=${encodeURIComponent(from)}&limit=500`);
    for (const c of rows) {
      const prev = await one(pool, 'SELECT status FROM pcs_calls WHERE id=$1', [c.id]);
      await pool.query(
        `INSERT INTO pcs_calls (id, call_no, mmsi, imo, vessel_name, agent_name, status, berth_code, eta, etd, ata, atd, berthed_at, entry_permit_no, departure_clearance_no, dangerous_goods, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, berth_code=EXCLUDED.berth_code, eta=EXCLUDED.eta, etd=EXCLUDED.etd, ata=EXCLUDED.ata, atd=EXCLUDED.atd,
           berthed_at=EXCLUDED.berthed_at, entry_permit_no=EXCLUDED.entry_permit_no, departure_clearance_no=EXCLUDED.departure_clearance_no, mmsi=EXCLUDED.mmsi,
           dangerous_goods=EXCLUDED.dangerous_goods, synced_at=now()`,
        [c.id, c.call_no, c.mmsi ?? null, c.imo ?? null, c.vessel_name, c.agent_name, c.status, c.berth_code ?? null, c.eta, c.etd, c.ata, c.atd, c.berthed_at,
          c.entry_permit_no ?? null, c.departure_clearance_no ?? null, !!c.dangerous_goods],
      );
      // Enrich static vessel data from the PCS (authoritative IMO/name)
      if (c.mmsi) await pool.query(
        `INSERT INTO vessels (mmsi, imo, name, call_sign, length, draught) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (mmsi) DO UPDATE SET imo=coalesce(vessels.imo, EXCLUDED.imo), name=coalesce(vessels.name, EXCLUDED.name), call_sign=coalesce(vessels.call_sign, EXCLUDED.call_sign),
           length=coalesce(vessels.length, EXCLUDED.length), draught=coalesce(EXCLUDED.draught, vessels.draught)`,
        [c.mmsi, c.imo, c.vessel_name, c.call_sign ?? null, c.loa ?? null, c.arrival_draft ?? null]);
      if (prev && prev.status !== c.status) await log('PCS', `PCS ${c.call_no} ${c.vessel_name}: ${prev.status} → ${c.status}`, c.mmsi);
    }
    pcsState.callCount = rows.length;
    pcsState.lastSync = new Date();
    pcsState.lastError = null;
  } catch (e: any) {
    pcsState.lastError = e.message;
  }
}

/** Queue a movement report (idempotent per call+action). */
export async function queueMovement(callId: string, action: 'arrived' | 'berthed' | 'departed', at: Date, why: string, mmsi?: string | null) {
  const r = await pool.query('INSERT INTO pcs_outbox (call_id, action, at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [callId, action, at]);
  if (r.rowCount) await log('PCS', `Movement queued for PCS: ${action.toUpperCase()} (${why})`, mmsi);
}

export async function dispatchMovements() {
  if (!pcsEnabled()) return;
  const rows = await many(pool, `SELECT o.*, c.call_no, c.mmsi FROM pcs_outbox o LEFT JOIN pcs_calls c ON c.id=o.call_id WHERE o.sent_at IS NULL AND o.attempts < 20 ORDER BY o.id LIMIT 20`);
  for (const o of rows) {
    try {
      await call(`/vessel-calls/${o.call_id}/${o.action}`, { method: 'POST', body: JSON.stringify({ at: o.at }) });
      await pool.query('UPDATE pcs_outbox SET sent_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1', [o.id]);
      await log('PCS', `Reported to PCS: ${o.action.toUpperCase()} for ${o.call_no} at ${new Date(o.at).toISOString().slice(11, 16)}Z`, o.mmsi);
    } catch (e: any) {
      await pool.query('UPDATE pcs_outbox SET attempts=attempts+1, last_error=$2 WHERE id=$1', [o.id, String(e.message).slice(0, 500)]);
    }
  }
  if (rows.length) await syncCalls();
}

/** Push the live picture to the PCS port map. */
export async function pushAis() {
  if (!pcsEnabled() || !config.pcsPushAis) return;
  const rows = await many(pool, `SELECT t.mmsi, v.imo, t.lat, t.lon, t.sog, t.cog, t.nav_status, t.at FROM targets t LEFT JOIN vessels v ON v.mmsi=t.mmsi
    WHERE 'VTS_AREA' = ANY(t.zones) AND t.at > now() - interval '10 minutes'`);
  if (!rows.length) return;
  try {
    await call('/ais/positions', {
      method: 'POST',
      body: JSON.stringify({
        source: 'VTS',
        positions: rows.map((r) => ({ mmsi: r.mmsi, imo: r.imo?.trim() || null, lat: r.lat, lon: r.lon, sog: r.sog, cog: r.cog == null ? null : r.cog % 360, navStatus: r.nav_status, at: r.at })),
      }),
    });
    pcsState.lastAisPush = new Date();
  } catch (e: any) {
    pcsState.lastError = e.message;
  }
}

/** Verify a PCS webhook (HMAC-SHA256 of the raw body, header x-pcs-signature: sha256=<hex>). */
export function verifyWebhook(raw: string, signature: string | undefined) {
  if (!config.pcsWebhookSecret || !signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.pcsWebhookSecret).update(raw).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function callForMmsi(mmsi: string) {
  return one(pool, `SELECT * FROM pcs_calls WHERE mmsi=$1 AND status NOT IN ('CANCELLED') ORDER BY (status='DEPARTED'), eta DESC LIMIT 1`, [mmsi]);
}
