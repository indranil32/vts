// Integration tests: traffic engine rules and the PCS bridge, against a real PostgreSQL and a mock PCS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vts_test';
const SECRET = 'test-webhook-secret';
const received: { method: string; url: string; body: any }[] = [];
const calls = [
  { id: '11111111-1111-4111-8111-111111111111', call_no: 'ZZALP-VC-1', mmsi: '999111001', imo: '9000001', vessel_name: 'PERMITTED ONE', agent_name: 'Agent', status: 'ARRIVAL_CLEARED', berth_code: 'A1', eta: new Date().toISOString(), entry_permit_no: 'PEP-1', dangerous_goods: false },
  { id: '22222222-2222-4222-8222-222222222222', call_no: 'ZZALP-VC-2', mmsi: '999111002', imo: '9000002', vessel_name: 'NO PERMIT TWO', agent_name: 'Agent', status: 'PRE_ARRIVAL_SUBMITTED', berth_code: 'N1', eta: new Date().toISOString(), entry_permit_no: null, dangerous_goods: true },
];
let mock: http.Server;
let m: any; // modules under test

before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.headers['x-api-key'] !== 'test-key') { res.writeHead(401).end('{"error":"bad key"}'); return; }
      received.push({ method: req.method!, url: req.url!, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(req.method === 'GET' && req.url!.startsWith('/api/vessel-calls') ? JSON.stringify(calls) : '{"ok":true}');
    });
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const port = (mock.address() as any).port;

  // fresh database
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  Object.assign(process.env, {
    ADMIN_DATABASE_URL: ADMIN, DATABASE_URL: ADMIN.replace(/\/\/[^@]+@/, '//vts_app:vts_app@'), APP_DB_PASSWORD: 'vts_app',
    PCS_URL: `http://127.0.0.1:${port}`, PCS_API_KEY: 'test-key', PCS_WEBHOOK_SECRET: SECRET, DEMO_PASSWORD: 'Test-pass-1', LOGIN_RATE_LIMIT: '1000',
  });
  const { migrate } = await import('../src/db/migrate.js');
  await migrate(() => {});
  const { seed } = await import('../src/db/seed.js');
  await seed({ log: () => {}, force: true });
  m = {
    engine: await import('../src/engine.js'),
    pcs: await import('../src/pcs.js'),
    db: await import('../src/core/db.js'),
    server: await import('../src/server.js'),
  };
});
after(async () => { mock.close(); await m?.db.pool.end(); });

const report = (mmsi: string, name: string, lat: number, lon: number, sog: number, cog: number, extra: any = {}) =>
  m.engine.ingest({ type: 1, mmsi, name, lat, lon, sog, cog, heading: Math.round(cog), length: 200, ...extra }, 'TEST');
const open = async (type: string) => (await m.db.pool.query(`SELECT * FROM alerts WHERE type=$1 AND status='OPEN'`, [type])).rows;

test('PCS sync mirrors port calls and enriches vessels', async () => {
  await m.pcs.syncCalls();
  assert.equal(m.pcs.pcsState.lastError, null);
  const r = await m.db.pool.query('SELECT * FROM pcs_calls ORDER BY call_no');
  assert.equal(r.rowCount, 2);
  assert.equal((await m.pcs.callForMmsi('999111001')).status, 'ARRIVAL_CLEARED');
});

test('engine raises VTS alerts and queues movement reports', async () => {
  await report('999111001', 'PERMITTED ONE', 0.015, 0.12, 8, 270);   // inbound in fairway, permitted
  await report('999111002', 'NO PERMIT TWO', 0.015, 0.08, 8, 270);   // inbound in fairway, no permit
  await report('999222001', 'HEAD ON A', 0.05, 0.2, 12, 0);           // close-quarters pair
  await report('999222002', 'HEAD ON B', 0.08, 0.2, 12, 180);
  await report('999222003', 'TRESPASSER', -0.02, 0.05, 5, 90);        // restricted area
  await report('999222004', 'SPEEDY', 0.024, 0.04, 16, 0);             // speeding in the fairway
  await m.engine.tick();

  const t = (await m.db.pool.query(`SELECT traffic_status, zones FROM targets WHERE mmsi='999111001'`)).rows[0];
  assert.equal(t.traffic_status, 'INBOUND');
  assert.ok(t.zones.includes('Main Fairway'));

  const noPermit = await open('NO_ENTRY_PERMIT');
  assert.equal(noPermit.length, 1);
  assert.equal(noPermit[0].mmsi, '999111002');
  assert.equal(noPermit[0].severity, 'ALARM');
  const cpa = await open('CPA');
  assert.equal(cpa.length, 1);
  assert.deepEqual([cpa[0].mmsi, cpa[0].mmsi2].sort(), ['999222001', '999222002']);
  assert.equal((await open('RESTRICTED_AREA'))[0]?.mmsi, '999222003');
  assert.equal((await open('SPEED'))[0]?.mmsi, '999222004');
  assert.equal((await open('UNKNOWN_VESSEL')).map((a: any) => a.mmsi).includes('999222004'), true);

  const ob = (await m.db.pool.query('SELECT * FROM pcs_outbox')).rows;
  assert.deepEqual(ob.map((o: any) => [o.call_id, o.action]), [[calls[0].id, 'arrived']]);
});

test('movement reports and the AIS picture are delivered to the PCS', async () => {
  received.length = 0;
  await m.pcs.dispatchMovements();
  const mv = received.find((r) => r.method === 'POST' && r.url === `/api/vessel-calls/${calls[0].id}/arrived`);
  assert.ok(mv, 'arrived posted to PCS');
  assert.ok(mv!.body.at);
  assert.ok((await m.db.pool.query('SELECT sent_at FROM pcs_outbox')).rows[0].sent_at);

  await m.pcs.pushAis();
  const push = received.find((r) => r.url === '/api/ais/positions');
  assert.ok(push);
  assert.equal(push!.body.source, 'VTS');
  assert.ok(push!.body.positions.some((p: any) => p.mmsi === '999111001'));
});

test('alerts auto-clear when the condition ends', async () => {
  await report('999222003', 'TRESPASSER', -0.05, 0.03, 5, 270); // left the restricted area
  await m.engine.tick();
  assert.equal((await open('RESTRICTED_AREA')).length, 0);
});

test('API: roles, alert handling, clearances and signed PCS webhooks', async () => {
  const app = await m.server.buildApp({ logger: false });
  const login = async (email: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Test-pass-1' } })).json().token;
  const op = await login('operator@vts.demo');
  const viewer = await login('viewer@vts.demo');
  assert.ok(op && viewer);
  assert.equal((await app.inject({ url: '/api/picture' })).statusCode, 401);

  const pic = (await app.inject({ url: '/api/picture', headers: { authorization: `Bearer ${viewer}` } })).json();
  const pv = pic.targets.find((x: any) => x.mmsi === '999111002');
  assert.equal(pv.call_no, 'ZZALP-VC-2');
  assert.ok(pv.open_alerts >= 1);

  const alert = (await open('NO_ENTRY_PERMIT'))[0];
  assert.equal((await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/ack`, headers: { authorization: `Bearer ${viewer}` }, payload: {} })).statusCode, 403);
  const ack = await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/ack`, headers: { authorization: `Bearer ${op}` }, payload: { note: 'Called on Ch 12, vessel holding' } });
  assert.equal(ack.statusCode, 200);
  assert.equal(ack.json().status, 'ACKNOWLEDGED');

  const cl = await app.inject({ method: 'POST', url: '/api/clearances', headers: { authorization: `Bearer ${op}` }, payload: { mmsi: '999111002', type: 'ENTER_FAIRWAY', validMinutes: 30 } });
  assert.equal(cl.statusCode, 200);
  assert.match(cl.json().warnings[0], /no port entry permit/);

  const body = JSON.stringify({ id: 1, type: 'vessel_call.status_changed', data: {} });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  assert.equal((await app.inject({ method: 'POST', url: '/api/pcs/webhook', headers: { 'content-type': 'application/json', 'x-pcs-signature': 'sha256=bad' }, payload: body })).statusCode, 401);
  received.length = 0;
  const ok = await app.inject({ method: 'POST', url: '/api/pcs/webhook', headers: { 'content-type': 'application/json', 'x-pcs-signature': sig }, payload: body });
  assert.equal(ok.statusCode, 200);
  assert.ok(received.some((r) => r.url.startsWith('/api/vessel-calls')), 'webhook triggers a resync');
  await app.close();
});
