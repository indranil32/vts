import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AisDecoder, checksumOk, encodePosition, encodeStatic, distanceNm, bearingDeg, destination, pointInPolygon, segmentsIntersect, cpaTcpa, circle } from '@vts/shared';

test('decodes a reference type 1 position report', () => {
  const d = new AisDecoder();
  const r = d.line('!AIVDM,1,1,,B,15M67FC000G?ufbE`FepT@3n00Sa,0*5C');
  assert.ok(r);
  assert.equal(r!.mmsi, '366053209');
  assert.equal(r!.type, 1);
  assert.ok(Math.abs(r!.lat! - 37.8024) < 0.001);
  assert.ok(Math.abs(r!.lon! + 122.3415) < 0.001);
});

test('rejects bad checksums and reassembles multipart type 5', () => {
  assert.equal(checksumOk('!AIVDM,1,1,,B,15M67FC000G?ufbE`FepT@3n00Sa,0*00'), false);
  const d = new AisDecoder();
  const [a, b] = encodeStatic({ mmsi: '999112000', imo: '9312345', callSign: 'ZZAB1', name: 'OCEAN PIONEER', shipType: 70, length: 294, beam: 32, draught: 12.5, destination: 'ZZALP' }, 3);
  assert.equal(d.line(a), null);
  const r = d.line(b)!;
  assert.equal(r.name, 'OCEAN PIONEER');
  assert.equal(r.imo, '9312345');
  assert.equal(r.callSign, 'ZZAB1');
  assert.equal(r.length, 294);
  assert.equal(r.draught, 12.5);
  assert.equal(r.destination, 'ZZALP');
});

test('position encode/decode round trip', () => {
  const d = new AisDecoder();
  const r = d.line(encodePosition({ mmsi: '999000101', lat: -0.0123, lon: 0.1456, sog: 12.3, cog: 271.4, heading: 271, navStatus: 0 }))!;
  assert.equal(r.mmsi, '999000101');
  assert.ok(Math.abs(r.lat! + 0.0123) < 1e-5);
  assert.ok(Math.abs(r.lon! - 0.1456) < 1e-5);
  assert.equal(r.sog, 12.3);
  assert.equal(r.cog, 271.4);
});

test('geometry helpers', () => {
  assert.ok(Math.abs(distanceNm([0, 0], [1, 0]) - 60) < 0.1);
  assert.ok(Math.abs(bearingDeg([0, 0], [0, 1]) - 90) < 0.01);
  const p = destination([0, 0], 45, 10);
  assert.ok(Math.abs(distanceNm([0, 0], p) - 10) < 0.01);
  assert.ok(pointInPolygon([0.5, 0.5], [[0, 0], [0, 1], [1, 1], [1, 0]]));
  assert.ok(!pointInPolygon([1.5, 0.5], [[0, 0], [0, 1], [1, 1], [1, 0]]));
  assert.ok(segmentsIntersect([0, 0], [1, 1], [0, 1], [1, 0]));
  assert.ok(!segmentsIntersect([0, 0], [0.4, 0.4], [0, 1], [1, 0]));
  assert.equal(circle([0, 0], 1, 12).length, 12);
});

test('CPA/TCPA for head-on and parallel tracks', () => {
  // head-on, 2 nm apart, 10 kn each → meet in 6 min
  const a = { pos: [0, 0] as [number, number], sog: 10, cog: 90 };
  const b = { pos: [0, 2 / 60] as [number, number], sog: 10, cog: 270 };
  const r = cpaTcpa(a, b);
  assert.ok(r.cpaNm < 0.01);
  assert.ok(Math.abs(r.tcpaMin - 6) < 0.1);
  // parallel same speed → no closing
  const p = cpaTcpa({ pos: [0, 0], sog: 10, cog: 0 }, { pos: [0, 1 / 60], sog: 10, cog: 0 });
  assert.ok(Math.abs(p.cpaNm - 1) < 0.01);
});
