import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });
export type Db = pg.Pool | pg.PoolClient;

export async function one<T = any>(c: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await c.query(sql, params)).rows[0] as T) ?? null;
}
export async function many<T = any>(c: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(sql, params)).rows as T[];
}
export async function getSetting<T = any>(key: string, dflt: T): Promise<T> {
  const r = await one(pool, 'SELECT value FROM settings WHERE key=$1', [key]);
  return (r?.value as T) ?? dflt;
}
export async function log(category: string, text: string, mmsi?: string | null, author = 'system', userId?: string | null) {
  await pool.query('INSERT INTO vts_log (category, text, mmsi, author, user_id) VALUES ($1,$2,$3,$4,$5)', [category, text, mmsi ?? null, author, userId ?? null]);
}
