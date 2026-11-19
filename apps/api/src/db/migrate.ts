import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../core/config.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate(log = console.log) {
  const client = new pg.Client({ connectionString: config.adminDatabaseUrl });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      log(`applying ${f}`);
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
    }
    // Application role: non-superuser so RLS is enforced.
    const pw = config.appDbPassword.replace(/'/g, "''");
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vts_app') THEN CREATE ROLE vts_app LOGIN PASSWORD '${pw}'; END IF;
    END $$`);
    await client.query('GRANT USAGE ON SCHEMA public TO vts_app');
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vts_app');
    await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vts_app');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  migrate().then(() => console.log('migrations complete'), (e) => { console.error(e); process.exit(1); });
}
