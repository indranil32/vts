const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : v.toLowerCase() === 'true');
export const config = {
  port: Number(process.env.PORT ?? 4100),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://vts_app:vts_app@localhost:5432/vts',
  adminDatabaseUrl: process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres@localhost:5432/vts',
  appDbPassword: process.env.APP_DB_PASSWORD ?? 'vts_app',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me-in-production-0123456789',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  workers: bool(process.env.WORKERS, true),
  // AIS source: SIMULATOR | NMEA_TCP | NMEA_UDP | PROVIDER | NONE
  aisSource: (process.env.AIS_SOURCE ?? 'SIMULATOR').toUpperCase(),
  nmeaHost: process.env.NMEA_HOST ?? '127.0.0.1',
  nmeaPort: Number(process.env.NMEA_PORT ?? 10110),
  providerUrl: process.env.AIS_PROVIDER_URL ?? '',
  providerKey: process.env.AIS_PROVIDER_KEY ?? '',
  simTimeFactor: Number(process.env.SIM_TIME_FACTOR ?? 6),
  // PCS integration
  pcsUrl: (process.env.PCS_URL ?? '').replace(/\/$/, ''),
  pcsApiKey: process.env.PCS_API_KEY ?? '',
  pcsWebhookSecret: process.env.PCS_WEBHOOK_SECRET ?? '',
  pcsAutoMovements: bool(process.env.PCS_AUTO_MOVEMENTS, true),
  pcsPushAis: bool(process.env.PCS_PUSH_AIS, true),
};
