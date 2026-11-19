// Navigation geometry. Distances in nautical miles, speeds in knots, angles in degrees true.
export type LatLon = [number, number]; // [lat, lon]

const R_NM = 3440.065; // Earth radius in nautical miles
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Position after travelling `nm` on `course` (great-circle). */
export function destination(p: LatLon, courseDeg: number, nm: number): LatLon {
  const d = nm / R_NM, th = rad(courseDeg), la = rad(p[0]), lo = rad(p[1]);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(th));
  const lo2 = lo + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [deg(la2), ((deg(lo2) + 540) % 360) - 180];
}

/** Ray-casting point-in-polygon on lat/lon (fine for harbour-scale polygons). Polygon as [[lat,lon],...]. */
export function pointInPolygon(p: LatLon, poly: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Do segments a1-a2 and b1-b2 intersect? Used for reporting-line crossings. */
export function segmentsIntersect(a1: LatLon, a2: LatLon, b1: LatLon, b2: LatLon): boolean {
  const o = (p: LatLon, q: LatLon, r: LatLon) => Math.sign((q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]));
  return o(a1, a2, b1) !== o(a1, a2, b2) && o(b1, b2, a1) !== o(b1, b2, a2);
}

/**
 * Closest point of approach between two vessels on constant course/speed.
 * Returns CPA distance (nm) and time to CPA (minutes; negative = already passed).
 */
export function cpaTcpa(a: { pos: LatLon; sog: number; cog: number }, b: { pos: LatLon; sog: number; cog: number }) {
  // Local flat projection in nm around a
  const kLon = 60 * Math.cos(rad(a.pos[0]));
  const bx = (b.pos[1] - a.pos[1]) * kLon, by = (b.pos[0] - a.pos[0]) * 60;
  const vax = a.sog * Math.sin(rad(a.cog)), vay = a.sog * Math.cos(rad(a.cog));
  const vbx = b.sog * Math.sin(rad(b.cog)), vby = b.sog * Math.cos(rad(b.cog));
  const dvx = vbx - vax, dvy = vby - vay; // relative velocity (kn)
  const dv2 = dvx * dvx + dvy * dvy;
  const tHours = dv2 < 1e-9 ? 0 : -(bx * dvx + by * dvy) / dv2;
  const cx = bx + dvx * tHours, cy = by + dvy * tHours;
  return { cpaNm: Math.sqrt(cx * cx + cy * cy), tcpaMin: tHours * 60, rangeNm: Math.sqrt(bx * bx + by * by) };
}

export function polygonCentroid(poly: LatLon[]): LatLon {
  const n = poly.length;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

/** Circle polygon (for drawing/defining circular areas). */
export function circle(center: LatLon, radiusNm: number, steps = 32): LatLon[] {
  return Array.from({ length: steps }, (_, i) => destination(center, (360 / steps) * i, radiusNm));
}
