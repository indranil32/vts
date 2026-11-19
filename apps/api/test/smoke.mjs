// Post-deploy smoke test: BASE_URL, DEMO_PASSWORD, optional EXPECT_PCS=true
const base = process.env.BASE_URL ?? 'http://localhost:4100';
const pw = process.env.DEMO_PASSWORD ?? 'Vts-demo-2026';
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); } };
const j = async (path, opts = {}) => { const r = await fetch(base + path, opts); if (!r.ok) throw new Error(`${path} → ${r.status}`); return r.json(); };
let token;
await check('health ok', async () => { const h = await j('/health'); if (h.status !== 'ok') throw new Error(h.status); });
await check('console served', async () => { const r = await fetch(base + '/'); const t = await r.text(); if (!t.includes('<div id="root">')) throw new Error('no SPA'); });
await check('login as harbour master', async () => { token = (await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'harbour@vts.demo', password: pw }) })).token; if (!token) throw new Error('no token'); });
const auth = () => ({ headers: { authorization: `Bearer ${token}` } });
await check('zones loaded', async () => { const z = await j('/api/zones', auth()); if (z.length < 10) throw new Error(`${z.length} zones`); });
await check('live traffic picture', async () => {
  for (let i = 0; i < 20; i++) { const p = await j('/api/picture', auth()); if (p.targets.length >= 3) return; await new Promise((r) => setTimeout(r, 3000)); }
  throw new Error('fewer than 3 targets after 60 s');
});
if (process.env.EXPECT_PCS === 'true') await check('PCS link synchronised', async () => {
  for (let i = 0; i < 20; i++) { const s = await j('/api/pcs/status', auth()); if (s.enabled && s.lastSync && !s.lastError) return; await new Promise((r) => setTimeout(r, 3000)); }
  const s = await j('/api/pcs/status', auth()); throw new Error(`enabled=${s.enabled} lastSync=${s.lastSync} error=${s.lastError}`);
});
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
