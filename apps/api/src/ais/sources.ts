// AIS sources. All of them deliver decoded reports to the engine through the same path.
//  - NMEA_TCP / NMEA_UDP: AIS base stations, receivers or AIS network feeds speaking NMEA 0183 (AIVDM)
//  - PROVIDER: commercial AIS data provider REST API (generic JSON mapping, polled)
//  - SIMULATOR: synthetic traffic (emits real AIVDM sentences through the decoder)
import net from 'node:net';
import dgram from 'node:dgram';
import { AisDecoder, NAV_STATUS, type AisReport } from '@vts/shared';
import { config } from '../core/config.js';
import { ingest } from '../engine.js';
import { log } from '../core/db.js';

export const sourceState = { type: config.aisSource, connected: false, messages: 0, decodeErrors: 0, lastMessageAt: null as Date | null, detail: '' };

export async function handleLine(line: string, decoder: AisDecoder, source: string) {
  const r = decoder.line(line);
  sourceState.decodeErrors = decoder.errors;
  if (!r) return;
  sourceState.messages++;
  sourceState.lastMessageAt = new Date();
  await ingest(r, source).catch(() => {});
}

export function startNmeaTcp() {
  const decoder = new AisDecoder();
  let buf = '';
  let delay = 1000;
  const connect = () => {
    const sock = net.connect({ host: config.nmeaHost, port: config.nmeaPort });
    sock.setEncoding('ascii');
    sock.on('connect', () => { sourceState.connected = true; delay = 1000; sourceState.detail = `${config.nmeaHost}:${config.nmeaPort}`; log('EVENT', `AIS feed connected (${config.nmeaHost}:${config.nmeaPort})`); });
    sock.on('data', async (d: string) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) await handleLine(l, decoder, 'AIS_TCP');
    });
    const retry = () => { if (sourceState.connected) log('EVENT', 'AIS feed disconnected — reconnecting'); sourceState.connected = false; setTimeout(connect, (delay = Math.min(delay * 2, 30_000))); };
    sock.on('error', () => {});
    sock.on('close', retry);
  };
  connect();
}

export function startNmeaUdp() {
  const decoder = new AisDecoder();
  const s = dgram.createSocket('udp4');
  s.on('message', async (m) => { for (const l of m.toString('ascii').split(/\r?\n/)) if (l) await handleLine(l, decoder, 'AIS_UDP'); });
  s.bind(config.nmeaPort, () => { sourceState.connected = true; sourceState.detail = `udp :${config.nmeaPort}`; });
}

/**
 * Generic provider adapter: GET {AIS_PROVIDER_URL} with `Authorization: Bearer {AIS_PROVIDER_KEY}` returning an array of
 * { mmsi, imo?, name?, lat, lon, speed|sog, course|cog, heading?, navStatus?|nav_status?, type? }. Providers with other
 * payloads get a small mapping function here; the engine contract (AisReport) stays the same.
 */
export function startProvider() {
  const poll = async () => {
    try {
      const r = await fetch(config.providerUrl, { headers: { authorization: `Bearer ${config.providerKey}` }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: any = await r.json();
      const rows: any[] = Array.isArray(data) ? data : data.data ?? data.vessels ?? [];
      for (const v of rows) {
        const rep: AisReport = {
          type: 1, mmsi: String(v.mmsi).padStart(9, '0'), imo: v.imo ? String(v.imo) : undefined, name: v.name ?? v.shipname,
          lat: Number(v.lat ?? v.latitude), lon: Number(v.lon ?? v.longitude), sog: Number(v.sog ?? v.speed ?? 0), cog: Number(v.cog ?? v.course ?? 0),
          heading: v.heading ?? undefined, navStatus: typeof v.navStatus === 'number' ? NAV_STATUS[v.navStatus] : (v.navStatus ?? v.nav_status),
        };
        sourceState.messages++;
        await ingest(rep, 'PROVIDER');
      }
      sourceState.connected = true;
      sourceState.lastMessageAt = new Date();
    } catch (e: any) {
      sourceState.connected = false;
      sourceState.detail = e.message;
    }
  };
  poll();
  setInterval(poll, 30_000).unref();
}
