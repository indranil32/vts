import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ROLES, ZONE_TYPES, CLEARANCE_TYPES, type Role } from '@vts/shared';
import { pool, one, many, log, getSetting } from '../core/db.js';
import { config } from '../core/config.js';
import { DEFAULT_THRESHOLDS, invalidateZones } from '../engine.js';
import { pcsEnabled, pcsState, syncCalls, queueMovement, dispatchMovements, verifyWebhook, callForMmsi } from '../pcs.js';
import { sourceState } from '../ais/sources.js';

export interface User { sub: string; name: string; roles: Role[] }
const user = (req: FastifyRequest) => req.user as User;
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const need = (req: FastifyRequest, ...roles: Role[]) => {
  const u = user(req);
  if (!u.roles.includes('VTS_ADMIN') && !roles.some((r) => u.roles.includes(r))) throw new HttpError(403, `Requires ${roles.join(' or ')}`);
};
const OPS: Role[] = ['VTS_OPERATOR', 'VTS_SUPERVISOR'];

const PICTURE = `
  SELECT t.mmsi, t.lat, t.lon, t.sog, t.cog, t.heading, t.nav_status, t.zones, t.traffic_status, t.at, t.source, t.anchor_lat, t.anchor_lon,
         v.name, v.imo, v.call_sign, v.ship_type_text, v.length, v.beam, v.draught, v.destination, v.ais_class,
         c.id AS pcs_call_id, c.call_no, c.status AS pcs_status, c.berth_code, c.eta AS pcs_eta, c.entry_permit_no, c.departure_clearance_no, c.agent_name, c.dangerous_goods,
         (SELECT count(*)::int FROM alerts a WHERE (a.mmsi=t.mmsi OR a.mmsi2=t.mmsi) AND a.status IN ('OPEN','ACKNOWLEDGED')) AS open_alerts
  FROM targets t LEFT JOIN vessels v ON v.mmsi=t.mmsi
  LEFT JOIN LATERAL (SELECT * FROM pcs_calls pc WHERE pc.mmsi=t.mmsi AND pc.status <> 'CANCELLED' ORDER BY (pc.status='DEPARTED'), pc.eta DESC LIMIT 1) c ON true`;

export default async function api(app: FastifyInstance) {
  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err?.name === 'ZodError') return reply.status(400).send({ error: 'Validation failed', details: err.issues });
    if (err?.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    reply.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  // ---------------- auth ----------------
  app.post('/auth/login', { config: { public: true, rateLimit: { max: Number(process.env.LOGIN_RATE_LIMIT ?? 20), timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const u = await one(pool, 'SELECT * FROM users WHERE lower(email)=lower($1) AND active', [b.email]);
    if (!u || !(await bcrypt.compare(b.password, u.password_hash))) throw new HttpError(401, 'Invalid email or password');
    await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
    return { token: app.jwt.sign({ sub: u.id, name: u.name, roles: u.roles }), user: { id: u.id, name: u.name, email: u.email, roles: u.roles } };
  });
  app.get('/auth/me', async (req) => ({ user: user(req), centre: await getSetting('centre', { name: 'VTS Centre' }) }));

  // ---------------- traffic picture ----------------
  app.get('/picture', async () => ({
    at: new Date(),
    targets: await many(pool, `${PICTURE} WHERE t.at > now() - interval '30 minutes' ORDER BY t.mmsi`),
  }));

  app.get('/stats', async () => one(pool, `SELECT
      (SELECT count(*)::int FROM targets WHERE 'VTS_AREA' = ANY(zones)) AS in_area,
      (SELECT count(*)::int FROM targets WHERE traffic_status='AT_ANCHOR') AS at_anchor,
      (SELECT count(*)::int FROM targets WHERE traffic_status IN ('INBOUND','OUTBOUND')) AS under_way,
      (SELECT count(*)::int FROM targets WHERE traffic_status='BERTHED') AS berthed,
      (SELECT count(*)::int FROM alerts WHERE status='OPEN' AND severity='ALARM') AS alarms,
      (SELECT count(*)::int FROM alerts WHERE status='OPEN') AS open_alerts,
      (SELECT count(*)::int FROM pcs_calls WHERE status IN ('BERTH_ALLOCATED','PRE_ARRIVAL_SUBMITTED','ARRIVAL_CLEARED') AND eta < now() + interval '24 hours') AS expected_24h`));

  app.get('/vessels/:mmsi', async (req) => {
    const { mmsi } = req.params as { mmsi: string };
    const t = await one(pool, `${PICTURE} WHERE t.mmsi=$1`, [mmsi]);
    const v = t ?? (await one(pool, 'SELECT * FROM vessels WHERE mmsi=$1', [mmsi]));
    if (!v) throw new HttpError(404, 'Unknown vessel');
    return {
      ...v,
      track: await many(pool, `SELECT lat, lon, sog, cog, at FROM track_points WHERE mmsi=$1 AND at > now() - interval '3 hours' ORDER BY at`, [mmsi]),
      alerts: await many(pool, `SELECT * FROM alerts WHERE (mmsi=$1 OR mmsi2=$1) ORDER BY raised_at DESC LIMIT 20`, [mmsi]),
      log: await many(pool, `SELECT * FROM vts_log WHERE mmsi=$1 ORDER BY at DESC LIMIT 40`, [mmsi]),
      clearances: await many(pool, `SELECT * FROM clearances WHERE mmsi=$1 ORDER BY created_at DESC LIMIT 10`, [mmsi]),
      pcsCall: await callForMmsi(mmsi),
    };
  });

  // ---------------- alerts ----------------
  app.get('/alerts', async (req) => {
    const q = z.object({ status: z.string().optional(), limit: z.coerce.number().max(500).default(200) }).parse(req.query);
    return many(pool, `SELECT a.*, v.name AS vessel_name, v2.name AS vessel2_name, u.name AS ack_by_name FROM alerts a
      LEFT JOIN vessels v ON v.mmsi=a.mmsi LEFT JOIN vessels v2 ON v2.mmsi=a.mmsi2 LEFT JOIN users u ON u.id=a.ack_by
      WHERE ($1::text IS NULL OR a.status = ANY(string_to_array($1, ','))) ORDER BY (a.status='OPEN') DESC, (a.severity='ALARM') DESC, a.raised_at DESC LIMIT $2`, [q.status ?? null, q.limit]);
  });
  app.post('/alerts/:id/ack', async (req) => {
    need(req, ...OPS);
    const { id } = req.params as { id: string };
    const { note } = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    const a = await one(pool, `UPDATE alerts SET status='ACKNOWLEDGED', ack_by=$2, ack_at=now(), ack_note=$3 WHERE id=$1 AND status='OPEN' RETURNING *`, [id, user(req).sub, note ?? null]);
    if (!a) throw new HttpError(409, 'Alert is not open');
    await log('EVENT', `Alert acknowledged: ${a.message}${note ? ` — ${note}` : ''}`, a.mmsi, user(req).name, user(req).sub);
    return a;
  });
  app.post('/alerts/:id/close', async (req) => {
    need(req, ...OPS);
    const { id } = req.params as { id: string };
    const a = await one(pool, `UPDATE alerts SET status='CLOSED', closed_at=now() WHERE id=$1 AND status IN ('OPEN','ACKNOWLEDGED') RETURNING *`, [id]);
    if (!a) throw new HttpError(409, 'Alert already closed');
    await log('EVENT', `Alert closed: ${a.message}`, a.mmsi, user(req).name, user(req).sub);
    return a;
  });

  // ---------------- VTS log ----------------
  app.get('/log', async (req) => {
    const q = z.object({ mmsi: z.string().optional(), category: z.string().optional(), search: z.string().optional(), limit: z.coerce.number().max(1000).default(300) }).parse(req.query);
    return many(pool, `SELECT l.*, v.name AS vessel_name FROM vts_log l LEFT JOIN vessels v ON v.mmsi=l.mmsi
      WHERE ($1::text IS NULL OR l.mmsi=$1) AND ($2::text IS NULL OR l.category=$2) AND ($3::text IS NULL OR l.text ILIKE '%'||$3||'%') ORDER BY l.at DESC LIMIT $4`,
      [q.mmsi ?? null, q.category ?? null, q.search ?? null, q.limit]);
  });
  app.post('/log', async (req) => {
    need(req, ...OPS);
    const b = z.object({ category: z.enum(['VHF', 'INSTRUCTION', 'INCIDENT', 'NOTE']), text: z.string().min(2).max(2000), mmsi: z.string().regex(/^\d{9}$/).optional() }).parse(req.body);
    await log(b.category, b.text, b.mmsi, user(req).name, user(req).sub);
    return { ok: true };
  });

  // ---------------- clearances ----------------
  app.get('/clearances', async () => many(pool, `SELECT c.*, v.name AS vessel_name FROM clearances c LEFT JOIN vessels v ON v.mmsi=c.mmsi ORDER BY c.created_at DESC LIMIT 200`));
  app.post('/clearances', async (req) => {
    need(req, ...OPS);
    const b = z.object({ mmsi: z.string().regex(/^\d{9}$/), type: z.enum(CLEARANCE_TYPES), validMinutes: z.number().int().min(5).max(24 * 60).default(60), remarks: z.string().max(500).optional() }).parse(req.body);
    const pcs = await callForMmsi(b.mmsi);
    const warnings: string[] = [];
    if (b.type === 'ENTER_FAIRWAY' && pcs && !['ARRIVAL_CLEARED', 'ARRIVED'].includes(pcs.status)) warnings.push(`PCS shows ${pcs.status}: no port entry permit yet`);
    if (b.type === 'LEAVE_BERTH' && pcs && pcs.status !== 'DEPARTURE_CLEARED') warnings.push(`PCS shows ${pcs.status}: departure not cleared by all agencies`);
    const c = await one(pool, `INSERT INTO clearances (mmsi, type, remarks, valid_until, issued_by, issued_by_name) VALUES ($1,$2,$3, now() + make_interval(mins => $4), $5, $6) RETURNING *`,
      [b.mmsi, b.type, b.remarks ?? null, b.validMinutes, user(req).sub, user(req).name]);
    await log('CLEARANCE', `Clearance ${b.type.replace(/_/g, ' ').toLowerCase()} issued, valid ${b.validMinutes} min${b.remarks ? ` — ${b.remarks}` : ''}${warnings.length ? ` [WARNING: ${warnings.join('; ')}]` : ''}`, b.mmsi, user(req).name, user(req).sub);
    return { ...c, warnings };
  });
  app.post('/clearances/:id/revoke', async (req) => {
    need(req, ...OPS);
    const { id } = req.params as { id: string };
    const c = await one(pool, `UPDATE clearances SET status='REVOKED' WHERE id=$1 AND status='ACTIVE' RETURNING *`, [id]);
    if (!c) throw new HttpError(409, 'Clearance is not active');
    await log('CLEARANCE', `Clearance ${c.type} revoked`, c.mmsi, user(req).name, user(req).sub);
    return c;
  });

  // ---------------- geography ----------------
  app.get('/zones', async () => many(pool, 'SELECT * FROM zones ORDER BY type, name'));
  app.get('/reporting-points', async () => many(pool, 'SELECT * FROM reporting_points ORDER BY name'));
  const zoneIn = z.object({
    name: z.string().min(2), type: z.enum(ZONE_TYPES), polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
    maxSpeed: z.number().positive().optional().nullable(), minDepth: z.number().positive().optional().nullable(), pcsBerthCode: z.string().optional().nullable(), active: z.boolean().default(true),
  });
  app.post('/zones', async (req) => {
    need(req, 'VTS_SUPERVISOR');
    const b = zoneIn.parse(req.body);
    const r = await one(pool, `INSERT INTO zones (name, type, polygon, max_speed, min_depth, pcs_berth_code, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.name, b.type, JSON.stringify(b.polygon), b.maxSpeed ?? null, b.minDepth ?? null, b.pcsBerthCode ?? null, b.active]);
    invalidateZones();
    await log('NOTE', `Zone created: ${b.name} (${b.type})`, null, user(req).name, user(req).sub);
    return r;
  });
  app.patch('/zones/:id', async (req) => {
    need(req, 'VTS_SUPERVISOR');
    const { id } = req.params as { id: string };
    const b = zoneIn.partial().parse(req.body);
    const r = await one(pool, `UPDATE zones SET name=coalesce($2,name), polygon=coalesce($3,polygon), max_speed=CASE WHEN $4::boolean THEN $5 ELSE max_speed END,
        min_depth=CASE WHEN $6::boolean THEN $7 ELSE min_depth END, active=coalesce($8,active) WHERE id=$1 RETURNING *`,
      [id, b.name ?? null, b.polygon ? JSON.stringify(b.polygon) : null, b.maxSpeed !== undefined, b.maxSpeed ?? null, b.minDepth !== undefined, b.minDepth ?? null, b.active ?? null]);
    if (!r) throw new HttpError(404, 'Zone not found');
    invalidateZones();
    await log('NOTE', `Zone updated: ${r.name}`, null, user(req).name, user(req).sub);
    return r;
  });

  // ---------------- replay ----------------
  app.get('/replay', async (req) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    if (q.to.getTime() - q.from.getTime() > 6 * 3.6e6) throw new HttpError(400, 'Replay window is limited to 6 hours');
    return many(pool, `SELECT p.mmsi, p.lat, p.lon, p.sog, p.cog, p.at, v.name, v.ship_type_text FROM track_points p LEFT JOIN vessels v ON v.mmsi=p.mmsi WHERE p.at BETWEEN $1 AND $2 ORDER BY p.at`, [q.from, q.to]);
  });

  // ---------------- PCS bridge ----------------
  app.get('/pcs/status', async () => ({
    enabled: pcsEnabled(), url: config.pcsUrl || null, autoMovements: config.pcsAutoMovements, pushAis: config.pcsPushAis, ...pcsState,
    outbox: await many(pool, `SELECT o.*, c.call_no, c.vessel_name FROM pcs_outbox o LEFT JOIN pcs_calls c ON c.id=o.call_id ORDER BY o.id DESC LIMIT 30`),
    calls: await many(pool, `SELECT * FROM pcs_calls ORDER BY CASE status WHEN 'ARRIVAL_CLEARED' THEN 1 WHEN 'PRE_ARRIVAL_SUBMITTED' THEN 2 WHEN 'BERTH_ALLOCATED' THEN 3 WHEN 'ARRIVED' THEN 4 WHEN 'DEPARTURE_CLEARED' THEN 5 WHEN 'BERTHED' THEN 6 ELSE 9 END, eta`),
  }));
  app.post('/pcs/sync', async (req) => { need(req, ...OPS); await syncCalls(); return pcsState; });
  app.post('/pcs/movement', async (req) => {
    need(req, 'VTS_SUPERVISOR', 'VTS_OPERATOR');
    const b = z.object({ callId: z.string().uuid(), action: z.enum(['arrived', 'berthed', 'departed']), at: z.coerce.date().default(() => new Date()) }).parse(req.body);
    const c = await one(pool, 'SELECT * FROM pcs_calls WHERE id=$1', [b.callId]);
    if (!c) throw new HttpError(404, 'Unknown PCS call');
    await pool.query('DELETE FROM pcs_outbox WHERE call_id=$1 AND action=$2 AND sent_at IS NULL', [b.callId, b.action]);
    await queueMovement(b.callId, b.action, b.at, `manual report by ${user(req).name}`, c.mmsi);
    await dispatchMovements();
    return one(pool, 'SELECT * FROM pcs_outbox WHERE call_id=$1 AND action=$2', [b.callId, b.action]);
  });
  // Signed webhooks from the PCS (vessel_call.* events) trigger an immediate resync
  app.post('/pcs/webhook', { config: { public: true, rawBody: true } }, async (req, reply) => {
    const raw = (req as any).rawBody ?? JSON.stringify(req.body);
    if (!verifyWebhook(raw, req.headers['x-pcs-signature'] as string | undefined)) return reply.status(401).send({ error: 'Bad signature' });
    const ev = req.body as any;
    if (String(ev?.type ?? '').startsWith('vessel_call.')) await syncCalls();
    return { ok: true };
  });

  // ---------------- settings & system ----------------
  app.get('/settings', async () => ({
    thresholds: { ...DEFAULT_THRESHOLDS, ...(await getSetting('thresholds', {})) },
    centre: await getSetting('centre', {}),
    ais: { ...sourceState },
  }));
  app.patch('/settings/thresholds', async (req) => {
    need(req, 'VTS_SUPERVISOR');
    const b = z.object({ cpaNm: z.number().min(0.05).max(5), tcpaMin: z.number().min(1).max(60), aisLostMin: z.number().min(1).max(60), anchorRadiusNm: z.number().min(0.02).max(1), cpaRangeNm: z.number().min(0.5).max(20), unknownVesselMinLength: z.number().min(0).max(400) }).partial().parse(req.body);
    const cur = await getSetting('thresholds', {});
    await pool.query(`INSERT INTO settings (key, value) VALUES ('thresholds', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ ...cur, ...b })]);
    await log('NOTE', `Alert thresholds changed: ${JSON.stringify(b)}`, null, user(req).name, user(req).sub);
    return { ok: true };
  });
  app.get('/users', async (req) => { need(req, 'VTS_ADMIN'); return many(pool, 'SELECT id, email, name, roles, active, last_login_at FROM users ORDER BY name'); });
  app.post('/users', async (req) => {
    need(req, 'VTS_ADMIN');
    const b = z.object({ email: z.string().email(), name: z.string().min(2), password: z.string().min(8), roles: z.array(z.enum(ROLES)).min(1) }).parse(req.body);
    return one(pool, 'INSERT INTO users (email, name, password_hash, roles) VALUES ($1,$2,$3,$4) RETURNING id, email, name, roles', [b.email, b.name, await bcrypt.hash(b.password, 10), b.roles]);
  });
}
