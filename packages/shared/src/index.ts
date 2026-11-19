// Shared VTS domain model (API + operator console).
export * from './geo.js';
export * from './ais.js';

export const ROLES = ['VTS_ADMIN', 'VTS_SUPERVISOR', 'VTS_OPERATOR', 'VTS_VIEWER'] as const;
export type Role = (typeof ROLES)[number];

/** Zone types follow common VTS practice (IALA VTS Manual). */
export const ZONE_TYPES = ['LAND', 'VTS_AREA', 'FAIRWAY', 'ANCHORAGE', 'PILOT_BOARDING', 'RESTRICTED', 'BERTH', 'PRECAUTIONARY'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const ALERT_TYPES = [
  'CPA',                    // close-quarters situation (CPA/TCPA below thresholds)
  'SPEED',                  // speed above the zone limit
  'RESTRICTED_AREA',        // vessel inside a restricted area
  'ANCHOR_DRAG',            // vessel at anchor moving / leaving its swing circle
  'AIS_LOST',               // no AIS update for a target inside the VTS area
  'NO_ENTRY_PERMIT',        // entering the fairway/port without a PCS port entry permit
  'NO_DEPARTURE_CLEARANCE', // leaving berth without PCS departure clearance
  'UNKNOWN_VESSEL',         // large vessel in the VTS area with no PCS call
  'GROUNDING_RISK',         // draught exceeds charted depth of the zone
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const TRAFFIC_STATUS = ['APPROACHING', 'IN_AREA', 'AT_ANCHOR', 'INBOUND', 'BERTHED', 'OUTBOUND', 'LEFT_AREA'] as const;
export type TrafficStatus = (typeof TRAFFIC_STATUS)[number];

export const CLEARANCE_TYPES = ['ENTER_FAIRWAY', 'PROCEED_TO_ANCHORAGE', 'LEAVE_BERTH', 'SHIFT_BERTH', 'ANCHOR'] as const;

/** Small craft that generate no permit/unknown-vessel alerts. */
export const SMALL_CRAFT = ['PILOT', 'TUG', 'PORT_TENDER', 'SAR', 'LAW_ENFORCEMENT', 'FISHING', 'PLEASURE', 'SAILING', 'DREDGING', 'ANTI_POLLUTION'];
