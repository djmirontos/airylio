import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeGeohash } from "../_shared/geo/geohash.ts";
import { detectCity } from "../_shared/geo/detectCity.ts";
import { buildCacheKey, roundToTimeBucket } from "../_shared/geo/cacheKey.ts";
import { getRouteEta } from "../_shared/google/routesClient.ts";
import { calculateDepartureTime } from "../_shared/engine/calculateDeparture.ts";

// CORS is not an abuse control - a script or curl ignores it entirely. It only
// constrains browsers. Set ALLOWED_ORIGIN if a web client is ever added; the
// rate limit below is what actually protects the Google spend.
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_ROUTES_API_KEY")!;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Abuse limits. Anonymous sign-up is open, so anyone can mint sessions; these
// bound how much paid Google Routes traffic a single device can drive.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 10;
const RATE_LIMIT_DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_DAY = 200;

// Labels are free-form client input stored on every trip row. Unbounded, they
// are a cheap way to write arbitrary volumes into the database.
const MAX_LABEL_LENGTH = 200;
// Guards against clock-skewed or junk timestamps reaching the engine.
const MAX_TARGET_TIME_SKEW_MS = 365 * 24 * 60 * 60 * 1000;

function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function sanitizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, MAX_LABEL_LENGTH);
}

/**
 * Reads a cached Google response, returning null if the row is not shaped the
 * way we expect. A malformed row is then treated as a miss and refetched,
 * rather than throwing and 500-ing every request that hits that cache key
 * until it expires.
 */
function parseCachedRoute(
  cacheHit: any,
): { durationSeconds: number; distanceMeters: number; encodedPolyline?: string } | null {
  const route = cacheHit?.google_response?.routes?.[0];
  if (!route) return null;

  const durationSeconds = parseInt(String(route.duration ?? "").replace("s", ""), 10);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const distanceMeters = Number(route.distanceMeters);
  if (!Number.isFinite(distanceMeters)) return null;

  return {
    durationSeconds,
    distanceMeters,
    encodedPolyline: route.polyline?.encodedPolyline,
  };
}

/**
 * Counts a device's recent activity for the throttle.
 *
 * Prefers calculation_events: it records cache hits and Google failures as well
 * as successes, so a caller who only ever triggers failures - which write no
 * trip row - is still counted. Falls back to counting trips if that table or
 * its created_at column is not queryable.
 *
 * Returns null if neither source can be counted, which the caller treats as
 * "allow".
 */
async function countRecentActivity(
  admin: any,
  deviceId: string,
  sinceIso: string,
): Promise<number | null> {
  const events = await admin
    .from("calculation_events")
    .select("calculation_id", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .gte("created_at", sinceIso);

  if (!events.error) return events.count ?? 0;

  const trips = await admin
    .from("trips")
    .select("id", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .gte("created_at", sinceIso);

  if (!trips.error) {
    console.warn("rate limit falling back to trips count", { message: events.error.message });
    return trips.count ?? 0;
  }

  console.error("rate limit check failed on both sources", {
    deviceId,
    events: events.error.message,
    trips: trips.error.message,
  });
  return null;
}

/**
 * Per-device throttle.
 *
 * Fails open: if the counts cannot be read we let the request through rather
 * than locking every user out of the app on a transient database problem. That
 * is logged loudly, because a persistent failure here means the Google spend is
 * effectively unprotected.
 */
async function isRateLimited(admin: any, deviceId: string): Promise<boolean> {
  const minuteCount = await countRecentActivity(
    admin,
    deviceId,
    new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString(),
  );
  if (minuteCount === null) return false;
  if (minuteCount >= RATE_LIMIT_MAX_PER_WINDOW) {
    console.warn("rate limit hit (per minute)", { deviceId, minuteCount });
    return true;
  }

  const dayCount = await countRecentActivity(
    admin,
    deviceId,
    new Date(Date.now() - RATE_LIMIT_DAY_MS).toISOString(),
  );
  if (dayCount === null) return false;
  if (dayCount >= RATE_LIMIT_MAX_PER_DAY) {
    console.warn("rate limit hit (per day)", { deviceId, dayCount });
    return true;
  }

  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: corsHeaders });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: corsHeaders });
    }
    const deviceId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { error: deviceError } = await admin.from("devices").upsert({ id: deviceId }, { onConflict: "id" });
    if (deviceError) {
      // Not fatal - the calculation does not depend on it - but it should not
      // fail silently the way it did before.
      console.error("devices upsert failed", { deviceId, message: deviceError.message });
    }

    // Per-device throttle. Anonymous sign-up is open, so a caller can mint
    // unlimited identities; this caps what any single one can spend against the
    // paid Routes API. See countRecentActivity for which table it counts.
    const rateLimited = await isRateLimited(admin, deviceId);
    if (rateLimited) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
        },
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), { status: 400, headers: corsHeaders });
    }

    const {
      originLat, originLng, destLat, destLng,
      targetTime, transportMode,
      planningMode = "arrive_by", // defensive default for older clients not yet updated
    } = body ?? {};

    // typeof x === "number" alone accepts NaN and Infinity, both of which reach
    // the geohasher and the Google request as garbage. Check finiteness and
    // real-world bounds instead.
    if (!isValidLatitude(originLat) || !isValidLongitude(originLng)) {
      return new Response(JSON.stringify({ error: "Invalid origin coordinates" }), { status: 400, headers: corsHeaders });
    }
    if (!isValidLatitude(destLat) || !isValidLongitude(destLng)) {
      return new Response(JSON.stringify({ error: "Invalid destination coordinates" }), { status: 400, headers: corsHeaders });
    }
    if (typeof transportMode !== "string" || !transportMode || transportMode.length > 40) {
      return new Response(JSON.stringify({ error: "Invalid transport mode" }), { status: 400, headers: corsHeaders });
    }
    if (planningMode !== "arrive_by" && planningMode !== "leave_at") {
      return new Response(JSON.stringify({ error: "Invalid planning mode" }), { status: 400, headers: corsHeaders });
    }
    // An unparseable targetTime becomes NaN inside the engine and silently
    // produces nonsense departure times rather than failing.
    if (typeof targetTime !== "string") {
      return new Response(JSON.stringify({ error: "Invalid target time" }), { status: 400, headers: corsHeaders });
    }
    const targetTimeMs = Date.parse(targetTime);
    if (!Number.isFinite(targetTimeMs) || Math.abs(targetTimeMs - Date.now()) > MAX_TARGET_TIME_SKEW_MS) {
      return new Response(JSON.stringify({ error: "Invalid target time" }), { status: 400, headers: corsHeaders });
    }

    const originLabel = sanitizeLabel(body?.originLabel, "Unknown origin");
    const destinationLabel = sanitizeLabel(body?.destinationLabel, "Unknown destination");
    const originHash = encodeGeohash(originLat, originLng, 7);
    const destinationHash = encodeGeohash(destLat, destLng, 7);

    const { data: cityRows, error: cityError } = await admin.from("city_profiles").select("*");
    if (cityError) throw cityError;

    const cityBoundaries = cityRows.map((c: any) => ({
      cityCode: c.city_code,
      launchPriority: c.launch_priority ?? 999,
      boundary: {
        minLat: c.boundary_config.min_lat,
        maxLat: c.boundary_config.max_lat,
        minLng: c.boundary_config.min_lng,
        maxLng: c.boundary_config.max_lng,
      },
    }));
    const cityCode = detectCity(originLat, originLng, cityBoundaries);

    if (!cityCode) {
      await admin.from("calculation_events").insert({
        device_id: deviceId,
        calculation_id: crypto.randomUUID(),
        event_type: "no_route_found",
        metadata: { reason: "origin outside all supported city boundaries" },
      });
      return new Response(JSON.stringify({ error: "Location not in a supported city" }), { status: 400, headers: corsHeaders });
    }

    const cityProfileRow = cityRows.find((c: any) => c.city_code === cityCode);

    const { data: transportRow, error: transportError } = await admin
      .from("transport_profiles").select("routing_mode").eq("mode_key", transportMode).single();
    if (transportError || !transportRow) {
      return new Response(JSON.stringify({ error: "Unsupported transport mode" }), { status: 400, headers: corsHeaders });
    }

    // Fetch real weather from Open-Meteo (falls back to 'clear' on any failure)
    let weatherCondition: "clear" | "rain" | "heavy_rain" | "storm" = "clear";
    try {
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${originLat}&longitude=${originLng}&current=weathercode&timezone=auto`
      );
      if (weatherRes.ok) {
        const weatherData = await weatherRes.json();
        const code = weatherData?.current?.weathercode ?? -1;
        if (code >= 95) weatherCondition = code >= 96 ? "storm" : "heavy_rain";
        else if (code >= 80 || (code >= 51 && code <= 67)) weatherCondition = "rain";
      }
    } catch {
      // Open-Meteo unavailable � silent fallback to 'clear'
    }

    const requestTime = new Date();
    const cacheKey = buildCacheKey({
      originHash, destinationHash, transportMode, requestTime, weatherCondition,
    });

    let durationSeconds: number;
    let distanceMeters: number;
    let encodedPolyline: string | undefined;
    let dataFreshness: "live" | "cached" | "estimated";
    const calculationId = crypto.randomUUID();

    const { data: cacheHit, error: cacheError } = await admin
      .from("route_cache").select("*").eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cacheError) {
      console.error("route_cache lookup failed (treating as miss)", { cacheKey, message: cacheError.message });
    }

    // A cache row that is not shaped as expected is treated as a miss, so one
    // bad row cannot 500 every request on that key until it expires.
    const cachedRoute = cacheHit ? parseCachedRoute(cacheHit) : null;
    if (cacheHit && !cachedRoute) {
      console.warn("discarding malformed route_cache row", { cacheKey });
    }

    if (cachedRoute) {
      durationSeconds = cachedRoute.durationSeconds;
      distanceMeters = cachedRoute.distanceMeters;
      encodedPolyline = cachedRoute.encodedPolyline;
      dataFreshness = "cached";
      await admin.from("calculation_events").insert({
        device_id: deviceId, calculation_id: calculationId, event_type: "cache_hit",
      });
    } else {
      const routeResult = await getRouteEta({
        originLat, originLng, destLat, destLng,
        travelMode: transportRow.routing_mode, apiKey: GOOGLE_API_KEY,
      });

      await admin.from("calculation_events").insert({
        device_id: deviceId, calculation_id: calculationId,
        event_type: routeResult.success ? "google_api_success" : routeResult.errorType.toLowerCase(),
        metadata: routeResult.success ? undefined : { message: routeResult.message },
      });

      if (routeResult.success) {
        durationSeconds = routeResult.durationSeconds;
        distanceMeters = routeResult.distanceMeters;
        encodedPolyline = routeResult.encodedPolyline;
        dataFreshness = "live";

        await admin.from("route_cache").insert({
          cache_key: cacheKey, origin_hash: originHash, destination_hash: destinationHash,
          transport_mode: transportMode, time_bucket: roundToTimeBucket(requestTime).toISOString(),
          weather_condition: weatherCondition, google_response: routeResult.rawResponse,
          expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
        });
      } else {
        const { data: corridorStat } = await admin
          .from("corridor_stats").select("avg_diff_seconds")
          .eq("origin_hash", originHash).eq("destination_hash", destinationHash)
          .eq("transport_mode", transportMode).maybeSingle();

        if (!corridorStat) {
          return new Response(JSON.stringify({
            error: "Unable to calculate route and no historical estimate available",
          }), { status: 502, headers: corsHeaders });
        }
        durationSeconds = Math.round(corridorStat.avg_diff_seconds);
        distanceMeters = 0;
        dataFreshness = "estimated";
        await admin.from("calculation_events").insert({
          device_id: deviceId, calculation_id: calculationId, event_type: "fallback_used",
        });
      }
    }

    const { data: versionRow, error: versionError } = await admin
      .from("recommendation_versions").select("*").eq("is_active", true).single();
    if (versionError || !versionRow) throw new Error("No active recommendation_versions row found");

    const engineResult = calculateDepartureTime({
      originHash, destinationHash, cityCode, transportMode,
      planningMode, targetTime, calculationTime: requestTime.toISOString(),
      weatherCondition, rawGoogleEtaSeconds: durationSeconds, dataFreshness,
      recommendationVersion: versionRow.buffer_config,
      cityProfile: {
        cityCode: cityProfileRow.city_code,
        timezone: cityProfileRow.timezone,
        rushHourConfig: cityProfileRow.rush_hour_config,
        weatherSensitivity: cityProfileRow.weather_sensitivity,
      },
    });

    const { data: tripRow, error: tripError } = await admin.from("trips").insert({
      id: calculationId, device_id: deviceId,
      origin_hash: originHash, destination_hash: destinationHash,
      city_code: cityCode, transport_mode: transportMode,
      origin_label: originLabel, destination_label: destinationLabel,
      origin_lat: originLat, origin_lng: originLng, destination_lat: destLat, destination_lng: destLng,
      planning_mode: planningMode, target_time: targetTime, calculation_timezone: cityProfileRow.timezone,
      raw_google_eta_seconds: durationSeconds,
      recommended_leave_time: engineResult.recommendedLeaveTime,
      predicted_arrival_time: engineResult.predictedArrivalTime,
      confidence_score: engineResult.confidenceScore,
      confidence_reason: engineResult.confidenceReason,
      recommendation_explanation: engineResult.recommendationExplanation,
      weather_condition: weatherCondition, data_freshness: dataFreshness,
      recommendation_version_id: versionRow.id,
      encoded_polyline: encodedPolyline,
    }).select().single();
    if (tripError) throw tripError;

    return new Response(JSON.stringify({
      tripId: tripRow.id,
      recommendedLeaveTime: engineResult.recommendedLeaveTime,
      predictedArrivalTime: engineResult.predictedArrivalTime,
      confidenceScore: engineResult.confidenceScore,
      confidenceReason: engineResult.confidenceReason,
      recommendationExplanation: engineResult.recommendationExplanation,
      dataFreshness,
      weatherCondition,
      distanceMeters,
      encodedPolyline,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    // Detail stays server-side. It previously went out in the response body,
    // which leaked Postgres constraint and table names to any caller.
    const errorId = crypto.randomUUID();
    console.error("calculate-trip error", {
      errorId,
      message: err?.message,
      stack: err?.stack,
    });
    return new Response(
      JSON.stringify({ error: "Internal server error", errorId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});




