import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeGeohash } from "../_shared/geo/geohash.ts";
import { detectCity } from "../_shared/geo/detectCity.ts";
import { buildCacheKey, roundToTimeBucket } from "../_shared/geo/cacheKey.ts";
import { getRouteEta } from "../_shared/google/routesClient.ts";
import { calculateDepartureTime } from "../_shared/engine/calculateDeparture.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_ROUTES_API_KEY")!;
const CACHE_TTL_MS = 10 * 60 * 1000;

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
    await admin.from("devices").upsert({ id: deviceId }, { onConflict: "id" });

    const body = await req.json();
    const {
      originLat, originLng, destLat, destLng,
      targetTime, transportMode,
      planningMode = "arrive_by", // defensive default for older clients not yet updated
      originLabel = "Unknown origin",
      destinationLabel = "Unknown destination",
    } = body;
    if (
      typeof originLat !== "number" || typeof originLng !== "number" ||
      typeof destLat !== "number" || typeof destLng !== "number" ||
      typeof targetTime !== "string" || typeof transportMode !== "string" ||
      (planningMode !== "arrive_by" && planningMode !== "leave_at")
    ) {
      return new Response(JSON.stringify({ error: "Missing or invalid request fields" }), { status: 400, headers: corsHeaders });
    }
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
      // Open-Meteo unavailable — silent fallback to 'clear'
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

    const { data: cacheHit } = await admin
      .from("route_cache").select("*").eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cacheHit) {
      durationSeconds = parseInt(String(cacheHit.google_response.routes[0].duration).replace("s", ""), 10);
      encodedPolyline = cacheHit.google_response.routes[0].polyline?.encodedPolyline;
      distanceMeters = cacheHit.google_response.routes[0].distanceMeters;
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
    console.error("calculate-trip error:", err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: err.message }), { status: 500, headers: corsHeaders });
  }
});




