// AIS (ITU-R M.1371) NMEA 0183 AIVDM/AIVDO decoder — no dependencies.
// Supports message types 1, 2, 3 (Class A position), 5 (static & voyage), 18 (Class B position),
// 19 (Class B extended), 24 (Class B static, parts A/B). Multi-sentence messages are reassembled.

export interface AisReport {
  type: number;
  mmsi: string;
  lat?: number; lon?: number;
  sog?: number; cog?: number; heading?: number; rot?: number;
  navStatus?: string;
  name?: string; callSign?: string; imo?: string; shipType?: number; shipTypeText?: string;
  length?: number; beam?: number; draught?: number; destination?: string; eta?: string;
  classB?: boolean;
}

export const NAV_STATUS = [
  'UNDER_WAY_ENGINE', 'AT_ANCHOR', 'NOT_UNDER_COMMAND', 'RESTRICTED_MANOEUVRABILITY', 'CONSTRAINED_BY_DRAUGHT',
  'MOORED', 'AGROUND', 'FISHING', 'UNDER_WAY_SAILING', 'RESERVED_9', 'RESERVED_10', 'TOWING_ASTERN', 'PUSHING_AHEAD',
  'RESERVED_13', 'AIS_SART', 'UNDEFINED',
];

export function shipTypeText(t?: number): string {
  if (t == null || t === 0) return 'UNKNOWN';
  if (t >= 70 && t <= 79) return 'CARGO';
  if (t >= 80 && t <= 89) return 'TANKER';
  if (t >= 60 && t <= 69) return 'PASSENGER';
  if (t >= 40 && t <= 49) return 'HIGH_SPEED_CRAFT';
  const m: Record<number, string> = { 30: 'FISHING', 31: 'TOWING', 32: 'TOWING', 33: 'DREDGING', 34: 'DIVING', 35: 'MILITARY', 36: 'SAILING', 37: 'PLEASURE', 50: 'PILOT', 51: 'SAR', 52: 'TUG', 53: 'PORT_TENDER', 54: 'ANTI_POLLUTION', 55: 'LAW_ENFORCEMENT', 58: 'MEDICAL' };
  return m[t] ?? 'OTHER';
}

function toBits(payload: string, fill: number): string {
  let bits = '';
  for (const ch of payload) {
    let v = ch.charCodeAt(0) - 48;
    if (v > 40) v -= 8;
    bits += v.toString(2).padStart(6, '0');
  }
  return fill ? bits.slice(0, bits.length - fill) : bits;
}
const uint = (b: string, s: number, l: number) => (s + l > b.length ? 0 : parseInt(b.slice(s, s + l), 2));
const int = (b: string, s: number, l: number) => {
  const v = uint(b, s, l);
  return b[s] === '1' ? v - 2 ** l : v;
};
const text = (b: string, s: number, l: number) => {
  const chars = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
  let out = '';
  for (let i = 0; i + 6 <= l && s + i + 6 <= b.length; i += 6) out += chars[uint(b, s + i, 6)];
  return out.replace(/@+$/, '').trim();
};
const latlon = (raw: number, isLat: boolean) => {
  const v = raw / 600000;
  if (isLat ? raw === 91 * 600000 : raw === 181 * 600000) return undefined;
  return Math.round(v * 1e6) / 1e6;
};

export function checksumOk(sentence: string): boolean {
  const m = sentence.match(/^[!$]([^*]+)\*([0-9A-Fa-f]{2})/);
  if (!m) return false;
  let c = 0;
  for (const ch of m[1]) c ^= ch.charCodeAt(0);
  return c === parseInt(m[2], 16);
}

/** Decode a complete binary payload. */
export function decodePayload(payload: string, fill = 0): AisReport | null {
  const b = toBits(payload, fill);
  const type = uint(b, 0, 6);
  const mmsi = String(uint(b, 8, 30)).padStart(9, '0');
  switch (type) {
    case 1: case 2: case 3: {
      const sog = uint(b, 50, 10), cog = uint(b, 116, 12), hdg = uint(b, 128, 9), rot = int(b, 42, 8);
      return {
        type, mmsi, navStatus: NAV_STATUS[uint(b, 38, 4)], rot: rot === -128 ? undefined : rot,
        sog: sog === 1023 ? undefined : sog / 10, lon: latlon(int(b, 61, 28), false), lat: latlon(int(b, 89, 27), true),
        cog: cog === 3600 ? undefined : cog / 10, heading: hdg === 511 ? undefined : hdg,
      };
    }
    case 5: {
      const imo = uint(b, 40, 30);
      const toBow = uint(b, 240, 9), toStern = uint(b, 249, 9), toPort = uint(b, 258, 6), toStbd = uint(b, 264, 6);
      const st = uint(b, 232, 8);
      const mo = uint(b, 274, 4), dy = uint(b, 278, 5), hr = uint(b, 283, 5), mi = uint(b, 288, 6);
      return {
        type, mmsi, imo: imo ? String(imo).padStart(7, '0') : undefined, callSign: text(b, 70, 42), name: text(b, 112, 120),
        shipType: st, shipTypeText: shipTypeText(st), length: toBow + toStern || undefined, beam: toPort + toStbd || undefined,
        eta: mo && dy ? `${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : undefined,
        draught: uint(b, 294, 8) / 10 || undefined, destination: text(b, 302, 120),
      };
    }
    case 18: case 19: {
      const sog = uint(b, 46, 10), cog = uint(b, 112, 12), hdg = uint(b, 124, 9);
      const r: AisReport = {
        type, mmsi, classB: true, sog: sog === 1023 ? undefined : sog / 10, lon: latlon(int(b, 57, 28), false), lat: latlon(int(b, 85, 27), true),
        cog: cog === 3600 ? undefined : cog / 10, heading: hdg === 511 ? undefined : hdg,
      };
      if (type === 19) { r.name = text(b, 143, 120); r.shipType = uint(b, 263, 8); r.shipTypeText = shipTypeText(r.shipType); }
      return r;
    }
    case 24: {
      const part = uint(b, 38, 2);
      if (part === 0) return { type, mmsi, classB: true, name: text(b, 40, 120) };
      const st = uint(b, 40, 8);
      return { type, mmsi, classB: true, shipType: st, shipTypeText: shipTypeText(st), callSign: text(b, 90, 42), length: uint(b, 132, 9) + uint(b, 141, 9) || undefined, beam: uint(b, 150, 6) + uint(b, 156, 6) || undefined };
    }
    default:
      return null;
  }
}

/** Stateful decoder for a stream of NMEA lines (reassembles multi-sentence messages). */
export class AisDecoder {
  private parts = new Map<string, { total: number; got: string[]; at: number }>();
  errors = 0;

  /** Feed one line; returns a report when a message completes. */
  line(raw: string): AisReport | null {
    const s = raw.trim().replace(/^\\[^\\]*\\/, ''); // strip NMEA 4.0 tag block
    if (!/^!(AI|AB|BS|SA)VD[MO],/.test(s)) return null;
    if (!checksumOk(s)) { this.errors++; return null; }
    const f = s.split('*')[0].split(',');
    const total = Number(f[1]), num = Number(f[2]), seq = f[3], payload = f[5], fill = Number(f[6] ?? 0);
    if (total === 1) return decodePayload(payload, fill);
    const key = `${seq}:${f[4]}`;
    const now = Date.now();
    const e = this.parts.get(key) ?? { total, got: [], at: now };
    e.got[num - 1] = payload;
    this.parts.set(key, e);
    for (const [k, v] of this.parts) if (now - v.at > 10_000) this.parts.delete(k);
    if (e.got.filter(Boolean).length === total) {
      this.parts.delete(key);
      return decodePayload(e.got.join(''), num === total ? fill : 0);
    }
    return null;
  }
}

// ---------- Encoder (used by the simulator and tests to produce genuine AIVDM sentences) ----------
function bitsFor(v: number, len: number) {
  const n = v < 0 ? 2 ** len + v : v;
  return Math.round(n).toString(2).padStart(len, '0').slice(-len);
}
function textBits(s: string, chars: number) {
  const table = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
  return s.toUpperCase().padEnd(chars, '@').slice(0, chars).split('').map((c) => bitsFor(Math.max(0, table.indexOf(c)), 6)).join('');
}
function armor(bits: string) {
  const fill = (6 - (bits.length % 6)) % 6;
  bits += '0'.repeat(fill);
  let out = '';
  for (let i = 0; i < bits.length; i += 6) {
    let v = parseInt(bits.slice(i, i + 6), 2) + 48;
    if (v > 87) v += 8;
    out += String.fromCharCode(v);
  }
  return { payload: out, fill };
}
function sentence(body: string) {
  let c = 0;
  for (const ch of body) c ^= ch.charCodeAt(0);
  return `!${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function encodePosition(r: { mmsi: string; lat: number; lon: number; sog: number; cog: number; heading?: number; navStatus?: number }): string {
  const bits = bitsFor(1, 6) + bitsFor(0, 2) + bitsFor(Number(r.mmsi), 30) + bitsFor(r.navStatus ?? 0, 4) + bitsFor(-128, 8)
    + bitsFor(Math.min(1022, r.sog * 10), 10) + '0' + bitsFor(r.lon * 600000, 28) + bitsFor(r.lat * 600000, 27)
    + bitsFor(r.cog * 10, 12) + bitsFor(r.heading ?? 511, 9) + bitsFor(60, 6) + bitsFor(0, 2) + bitsFor(0, 3) + '0' + bitsFor(0, 19);
  const { payload, fill } = armor(bits);
  return sentence(`AIVDM,1,1,,A,${payload},${fill}`);
}

export function encodeStatic(r: { mmsi: string; imo?: string; callSign?: string; name: string; shipType: number; length: number; beam: number; draught?: number; destination?: string }, seq = 1): string[] {
  const half = (n: number) => Math.round(n / 2);
  const bits = bitsFor(5, 6) + bitsFor(0, 2) + bitsFor(Number(r.mmsi), 30) + bitsFor(0, 2) + bitsFor(Number(r.imo ?? 0), 30)
    + textBits(r.callSign ?? '', 7) + textBits(r.name, 20) + bitsFor(r.shipType, 8)
    + bitsFor(half(r.length), 9) + bitsFor(r.length - half(r.length), 9) + bitsFor(half(r.beam), 6) + bitsFor(r.beam - half(r.beam), 6)
    + bitsFor(1, 4) + bitsFor(0, 4) + bitsFor(0, 5) + bitsFor(24, 5) + bitsFor(60, 6) + bitsFor((r.draught ?? 0) * 10, 8)
    + textBits(r.destination ?? '', 20) + '0' + '0';
  const { payload, fill } = armor(bits);
  const a = payload.slice(0, 60), b = payload.slice(60);
  return [sentence(`AIVDM,2,1,${seq},A,${a},0`), sentence(`AIVDM,2,2,${seq},A,${b},${fill}`)];
}
