import type { RailLeg, RailRoute } from "../engine/types.ts";

export type { RailLeg, RailRoute };

/**
 * MRT/LRT route detection for commute mode.
 *
 * Everything here is best-effort: detectRailRoute never throws. On any error -
 * missing tables, unseeded data, a corridor the network does not serve - it
 * returns null and the caller silently continues with Google Transit.
 */

/** Stage 1 pre-filter. Beyond this, a station is not worth considering. */
const MAX_STATION_DISTANCE_M = 1200;
/** Reject a station whose walk exceeds this. 15 min, per the feature plan. */
const MAX_WALK_SECONDS = 900;
/**
 * Metro Manila walking pace: the plan budgets 1 km per 15 minutes, which is
 * deliberately slower than a European or Japanese equivalent - broken
 * pavements, no shade at 35C, overpass climbs, vendor stalls.
 */
const WALK_SECONDS_PER_KM = 900;
/** Half of a 4-minute peak headway. */
const WAIT_SECONDS = 120;

const AM_PEAK_START = 6;
const AM_PEAK_END = 9;
const PM_PEAK_START = 17;
const PM_PEAK_END = 20;

interface Station {
  id: string;
  line: string;
  name: string;
  sequence: number;
  lat: number;
  lng: number;
}

interface Segment {
  from_station_id: string;
  to_station_id: string;
  avg_seconds: number;
}

interface Transfer {
  from_station_id: string;
  to_station_id: string;
  walk_seconds: number;
}

interface NearbyStation {
  station: Station;
  walkSeconds: number;
}

/** 'MRT3' -> 'MRT-3'. Leaves anything unrecognised untouched. */
function formatLine(line: string): string {
  const match = /^([A-Z]+)(\d+)$/.exec(line);
  return match ? `${match[1]}-${match[2]}` : line;
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function walkSecondsFor(meters: number): number {
  return Math.round((meters / 1000) * WALK_SECONDS_PER_KM);
}

/**
 * Peak window in Asia/Manila. requestTime is a UTC instant, and the peak
 * windows are local, so the hour has to be read in Manila time rather than the
 * server's.
 */
function peakTypeFor(requestTime: Date): "AM_PEAK" | "PM_PEAK" | null {
  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(requestTime);
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return null;
  if (hour >= AM_PEAK_START && hour < AM_PEAK_END) return "AM_PEAK";
  if (hour >= PM_PEAK_START && hour < PM_PEAK_END) return "PM_PEAK";
  return null;
}

/** Stations within the pre-filter radius whose walk is also short enough. */
function findNearby(stations: Station[], lat: number, lng: number): NearbyStation[] {
  return stations
    .map((station) => ({
      station,
      meters: haversineMeters(lat, lng, Number(station.lat), Number(station.lng)),
    }))
    .filter((candidate) => candidate.meters < MAX_STATION_DISTANCE_M)
    .map((candidate) => ({
      station: candidate.station,
      walkSeconds: walkSecondsFor(candidate.meters),
    }))
    .filter((candidate) => candidate.walkSeconds <= MAX_WALK_SECONDS)
    .sort((a, b) => a.walkSeconds - b.walkSeconds);
}

/**
 * Ride time between two stations on one line, walking the sequence and summing
 * each adjacent segment. Returns null if any segment is missing, so a gap in
 * the seeded data produces a fallback rather than an understated ETA.
 */
function rideSecondsBetween(
  from: Station,
  to: Station,
  stationsOnLine: Station[],
  segments: Segment[],
): number | null {
  if (from.id === to.id) return 0;

  const low = Math.min(from.sequence, to.sequence);
  const high = Math.max(from.sequence, to.sequence);
  const path = stationsOnLine
    .filter((s) => s.sequence >= low && s.sequence <= high)
    .sort((a, b) => a.sequence - b.sequence);

  if (path.length < 2) return null;

  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    // Segments may be stored in either direction.
    const segment = segments.find(
      (s) =>
        (s.from_station_id === a.id && s.to_station_id === b.id) ||
        (s.from_station_id === b.id && s.to_station_id === a.id),
    );
    if (!segment) return null;
    total += segment.avg_seconds;
  }
  return total;
}

interface Candidate {
  legs: RailLeg[];
  totalSeconds: number;
  queuePenaltySeconds: number;
  via: string;
  boardingStation: { name: string; lat: number; lng: number };
  alightingStation: { name: string; lat: number; lng: number };
}

export async function detectRailRoute(
  admin: any,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  requestTime: Date,
): Promise<RailRoute | null> {
  try {
    const { data: stationRows, error: stationError } = await admin
      .from("train_stations")
      .select("id, line, name, sequence, lat, lng, is_transfer_station");
    if (stationError || !stationRows?.length) return null;

    const stations = stationRows as Station[];
    const originNearby = findNearby(stations, originLat, originLng);
    const destNearby = findNearby(stations, destLat, destLng);
    if (!originNearby.length || !destNearby.length) return null;

    const { data: segmentRows } = await admin
      .from("train_segments")
      .select("from_station_id, to_station_id, avg_seconds");
    const segments = (segmentRows ?? []) as Segment[];
    if (!segments.length) return null;

    const peakType = peakTypeFor(requestTime);
    const queuePenaltyFor = async (stationId: string): Promise<number> => {
      if (!peakType) return 0;
      const { data } = await admin
        .from("train_queue_penalties")
        .select("penalty_seconds")
        .eq("station_id", stationId)
        .eq("peak_type", peakType)
        .maybeSingle();
      return data?.penalty_seconds ?? 0;
    };

    const { data: transferRows } = await admin
      .from("train_transfers")
      .select("from_station_id, to_station_id, walk_seconds");
    const transfers = (transferRows ?? []) as Transfer[];
    const stationById = new Map(stations.map((s) => [s.id, s]));

    const stationsByLine = (line: string) => stations.filter((s) => s.line === line);
    const candidates: Candidate[] = [];

    // Every boarding/alighting pair is evaluated - same-line and transfer
    // alike - and the lowest total wins.
    for (const board of originNearby) {
      for (const alight of destNearby) {
        if (board.station.id === alight.station.id) continue;

        const queuePenaltySeconds = await queuePenaltyFor(board.station.id);
        const boardLine = formatLine(board.station.line);

        // --- Same line ----------------------------------------------------
        if (board.station.line === alight.station.line) {
          const rideSeconds = rideSecondsBetween(
            board.station,
            alight.station,
            stationsByLine(board.station.line),
            segments,
          );
          if (rideSeconds === null) continue;

          const legs: RailLeg[] = [
            { type: "walk", label: `Walk to ${board.station.name}`, seconds: board.walkSeconds },
            { type: "wait", label: "Wait for train", seconds: WAIT_SECONDS + queuePenaltySeconds },
            { type: "ride", label: `${board.station.name} → ${alight.station.name}`, seconds: rideSeconds, line: board.station.line },
            { type: "walk", label: "Walk to destination", seconds: alight.walkSeconds },
          ];
          candidates.push({
            legs,
            totalSeconds: legs.reduce((sum, leg) => sum + leg.seconds, 0),
            queuePenaltySeconds,
            via: boardLine,
            boardingStation: {
              name: board.station.name,
              lat: Number(board.station.lat),
              lng: Number(board.station.lng),
            },
            alightingStation: {
              name: alight.station.name,
              lat: Number(alight.station.lat),
              lng: Number(alight.station.lng),
            },
          });
          continue;
        }

        // --- Different lines: one transfer --------------------------------
        for (const transfer of transfers) {
          // The record may be stored in either direction.
          for (const [fromId, toId] of [
            [transfer.from_station_id, transfer.to_station_id],
            [transfer.to_station_id, transfer.from_station_id],
          ]) {
            const exit = stationById.get(fromId);
            const enter = stationById.get(toId);
            if (!exit || !enter) continue;
            if (exit.line !== board.station.line) continue;
            if (enter.line !== alight.station.line) continue;

            const firstRide = rideSecondsBetween(
              board.station,
              exit,
              stationsByLine(board.station.line),
              segments,
            );
            const secondRide = rideSecondsBetween(
              enter,
              alight.station,
              stationsByLine(alight.station.line),
              segments,
            );
            if (firstRide === null || secondRide === null) continue;

            const alightLine = formatLine(alight.station.line);
            const legs: RailLeg[] = [
              { type: "walk", label: `Walk to ${board.station.name}`, seconds: board.walkSeconds },
              { type: "wait", label: "Wait for train", seconds: WAIT_SECONDS + queuePenaltySeconds },
              { type: "ride", label: `${board.station.name} → ${exit.name}`, seconds: firstRide, line: board.station.line },
              { type: "transfer", label: `Transfer at ${exit.name}`, seconds: transfer.walk_seconds },
              { type: "wait", label: "Wait for next train", seconds: WAIT_SECONDS },
              { type: "ride", label: `${enter.name} → ${alight.station.name}`, seconds: secondRide, line: alight.station.line },
              { type: "walk", label: "Walk to destination", seconds: alight.walkSeconds },
            ];
            candidates.push({
              legs,
              totalSeconds: legs.reduce((sum, leg) => sum + leg.seconds, 0),
              queuePenaltySeconds,
              // Origin line first.
              via: `${boardLine} + ${alightLine}`,
              boardingStation: {
                name: board.station.name,
                lat: Number(board.station.lat),
                lng: Number(board.station.lng),
              },
              alightingStation: {
                name: alight.station.name,
                lat: Number(alight.station.lat),
                lng: Number(alight.station.lng),
              },
            });
          }
        }
      }
    }

    if (!candidates.length) return null;

    const best = candidates.reduce((a, b) => (b.totalSeconds < a.totalSeconds ? b : a));
    return {
      legs: best.legs,
      totalSeconds: best.totalSeconds,
      queuePenaltySeconds: best.queuePenaltySeconds,
      via: best.via,
      routeType: "rail",
      boardingStation: best.boardingStation,
      alightingStation: best.alightingStation,
    };
  } catch (err) {
    console.error("rail detection failed (falling back to Google Transit)", {
      message: (err as Error)?.message,
    });
    return null;
  }
}
