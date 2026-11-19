// Electronic traffic image: zones, reporting lines, vessel symbols with speed vectors, track history.
import { Fragment, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, Tooltip, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { destination, type LatLon } from '@vts/shared';
import { STATUS_COLOR, ZONE_STYLE } from '../lib/format';

export interface Target {
  mmsi: string; lat: number; lon: number; sog: number | null; cog: number | null; heading: number | null; name?: string | null;
  traffic_status?: string | null; ship_type_text?: string | null; open_alerts?: number; length?: number | null; anchor_lat?: number | null; anchor_lon?: number | null;
  pcs_status?: string | null;
}

const SMALL = ['PILOT', 'TUG', 'FISHING', 'PLEASURE', 'SAILING', 'SAR', 'LAW_ENFORCEMENT', 'PORT_TENDER'];

function icon(t: Target, selected: boolean) {
  const color = t.open_alerts ? '#f87171' : STATUS_COLOR[t.traffic_status ?? ''] ?? '#94a3b8';
  const small = SMALL.includes(t.ship_type_text ?? '');
  const rot = Number(t.heading ?? t.cog ?? 0);
  const moving = Number(t.sog ?? 0) >= 0.5;
  const size = small ? 14 : 20;
  const shape = moving
    ? `<path d="M10 1 L16 18 L10 14 L4 18 Z" fill="${color}" fill-opacity=".9" stroke="#020617" stroke-width="1"/>`
    : `<circle cx="10" cy="10" r="${small ? 5 : 6}" fill="${color}" fill-opacity=".85" stroke="#020617" stroke-width="1"/>`;
  const ring = selected ? `<circle cx="10" cy="10" r="9.3" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="3 2"/>` : '';
  const alarm = t.open_alerts ? `<circle cx="10" cy="10" r="9.5" fill="none" stroke="#f87171" stroke-width="1.5" class="blink"/>` : '';
  return L.divIcon({
    className: '',
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 20 20" style="transform:rotate(${moving ? rot : 0}deg)">${shape}${ring}${alarm}</svg>`,
  });
}

function FitTo({ center, zoom }: { center: LatLon; zoom: number }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function FollowTarget({ pos }: { pos?: LatLon }) {
  const map = useMap();
  useEffect(() => { if (pos && !map.getBounds().pad(-0.15).contains(pos)) map.panTo(pos); }, [pos?.[0], pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function TrafficMap({ targets, zones, points, selected, onSelect, track, center, zoom = 13, vectorMin = 6, labels = true }: {
  targets: Target[]; zones: any[]; points: any[]; selected?: string | null; onSelect?: (mmsi: string) => void; track?: { lat: number; lon: number }[];
  center: LatLon; zoom?: number; vectorMin?: number; labels?: boolean;
}) {
  const ordered = useMemo(() => [...zones].sort((a, b) => (a.type === 'LAND' ? 1 : 0) - (b.type === 'LAND' ? 1 : 0)), [zones]);
  const sel = targets.find((t) => t.mmsi === selected);
  return (
    <MapContainer center={center} zoom={zoom} className="h-full w-full" zoomControl preferCanvas={false} attributionControl>
      <FitTo center={center} zoom={zoom} />
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png" attribution='&copy; OpenStreetMap contributors &copy; CARTO' />
      {ordered.map((z) => {
        const s = ZONE_STYLE[z.type] ?? ZONE_STYLE.PRECAUTIONARY;
        return (
          <Polygon key={z.id} positions={z.polygon} pathOptions={{ color: s.color, fillColor: s.fill, fillOpacity: s.fillOpacity, weight: s.weight ?? 1, dashArray: s.dash, interactive: z.type !== 'VTS_AREA' }}>
            {z.type !== 'VTS_AREA' && <Tooltip sticky>{z.name}{z.max_speed ? ` · max ${z.max_speed} kn` : ''}{z.min_depth ? ` · ${z.min_depth} m` : ''}</Tooltip>}
          </Polygon>
        );
      })}
      {points.map((p) => (
        <Polyline key={p.id} positions={p.line} pathOptions={{ color: '#f59e0b', weight: 1.5, dashArray: '1 5', lineCap: 'round' }}>
          <Tooltip sticky>{p.name}</Tooltip>
        </Polyline>
      ))}
      {track && track.length > 1 && <Polyline positions={track.map((p) => [p.lat, p.lon] as LatLon)} pathOptions={{ color: '#e2e8f0', weight: 1.5, opacity: 0.6, dashArray: '2 4' }} />}
      {sel?.anchor_lat != null && <Circle center={[sel.anchor_lat, sel.anchor_lon!]} radius={0.12 * 1852} pathOptions={{ color: '#fbbf24', weight: 1, dashArray: '2 3', fillOpacity: 0.03 }} />}
      {targets.map((t) => {
        const sog = Number(t.sog ?? 0);
        const pos: LatLon = [t.lat, t.lon];
        const end = sog >= 0.5 ? destination(pos, Number(t.cog ?? 0), (sog * vectorMin) / 60) : null;
        const color = t.open_alerts ? '#f87171' : STATUS_COLOR[t.traffic_status ?? ''] ?? '#94a3b8';
        return (
          <Fragment key={t.mmsi}>
            {end && <Polyline positions={[pos, end]} pathOptions={{ color, weight: 1.2, opacity: 0.8 }} interactive={false} />}
            <Marker position={pos} icon={icon(t, t.mmsi === selected)} eventHandlers={{ click: () => onSelect?.(t.mmsi) }} zIndexOffset={t.mmsi === selected ? 1000 : 0}>
              {labels && <Tooltip permanent direction="right" offset={[8, 0]} className="vlabel">{t.name ?? t.mmsi}</Tooltip>}
            </Marker>
          </Fragment>
        );
      })}
      <FollowTarget pos={sel ? [sel.lat, sel.lon] : undefined} />
    </MapContainer>
  );
}
