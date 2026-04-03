import type { Zone } from '../types/index.ts';

export const ZONES: Record<string, Zone> = {
  norway_murmansk: {
    name: 'Norway \u2192 Murmansk',
    bounds: [[65, 5], [72, 40]],
  },
  hormuz: {
    name: 'Strait of Hormuz',
    bounds: [[22, 52], [28, 60]],  // Wider: Persian Gulf entrance + Gulf of Oman
  },
  north_sea: {
    name: 'North Sea',
    bounds: [[50, -5], [62, 10]],
  },
  suez: {
    name: 'Suez Canal',
    bounds: [[27, 30], [32, 36]],  // Wider: Red Sea approach + Med approach
  },
};

/**
 * Determine which monitored zone a vessel is in based on its coordinates.
 * Returns the zone key or null if not in any monitored zone.
 */
export function getVesselZone(lat: number, lon: number): string | null {
  for (const [key, zone] of Object.entries(ZONES)) {
    const [[latMin, lonMin], [latMax, lonMax]] = zone.bounds;
    if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
      return key;
    }
  }
  return null;
}

/**
 * Get bounding boxes for all zones as an array suitable for AIS stream subscription.
 * Returns format: [[latMin, lonMin, latMax, lonMax], ...]
 */
export function getZoneBoundingBoxes(): Array<[[number, number], [number, number]]> {
  return Object.values(ZONES).map((zone) => zone.bounds);
}

/**
 * Get a zone by its key.
 */
export function getZone(key: string): Zone | undefined {
  return ZONES[key];
}
