// =============================================================================
// City detection via bounding-box lookup.
//
// Pure function: city boundary data is passed in (fetched from city_profiles
// by the caller), not fetched here — same pattern as the recommendation
// engine, keeps this testable without a database dependency.
//
// Overlap resolution: per the schema review, launch_priority is the
// tie-breaker when a coordinate falls inside more than one city's
// boundary (e.g. Metro Manila edge cases). Lowest launchPriority wins.
// =============================================================================

import type { CityBoundary } from "./types.ts";

export function detectCity(
  lat: number,
  lng: number,
  cities: CityBoundary[]
): string | null {
  const matches = cities.filter(
    (city) =>
      lat >= city.boundary.minLat &&
      lat <= city.boundary.maxLat &&
      lng >= city.boundary.minLng &&
      lng <= city.boundary.maxLng
  );

  if (matches.length === 0) {
    return null;
  }

  const winner = matches.reduce((best, current) =>
    current.launchPriority < best.launchPriority ? current : best
  );

  return winner.cityCode;
}
