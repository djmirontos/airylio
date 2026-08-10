// =============================================================================
// Airylio — Morning Brief
//
// Invoked by pg_cron every 15 minutes on weekdays. For every commute profile
// whose notification window has arrived, it runs the recommendation engine and
// pushes a departure recommendation when today's answer differs meaningfully
// from that profile's baseline.
//
// Trust model: this is server-to-server only. It runs under the service role,
// carries no user auth header, and is gated by a shared secret rather than a
// JWT. No CORS headers - a browser has no business calling it. It deliberately
// does NOT write to calculation_events: that table is the user-initiated audit
// log and the per-device rate limiter reads it, so automated traffic in there
// would both pollute the audit trail and eat into users' own quota.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectCity } from "../_shared/geo/detectCity.ts";
import { getRouteEta } from "../_shared/google/routesClient.ts";
import { calculateDepartureTime } from "../_shared/engine/calculateDeparture.ts";
import { encodeGeohash } from "../_shared/geo/geohash.ts";
import type { WeatherCondition } from "../_shared/engine/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_ROUTES_API_KEY")!;
const CRON_SECRET = Deno.env.get("MORNING_BRIEF_CRON_SECRET")!;

// The Expo push service send endpoint. NOT exp.host/--/exponent-push-token/,
// which is the token URL format, not an API route - posting there 404s.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Selection timezone. The Philippines has a fixed +08:00 offset and no DST, so
// a literal offset is safe when composing today's arrival deadline. Rush-hour
// detection still uses the per-city timezone from city_profiles, inside the
// engine - this constant only governs which profiles are due right now.
const APP_TIMEZONE = "Asia/Manila";
const APP_UTC_OFFSET = "+08:00";

const LEAD_MINUTES = 90; // Notification fires this far ahead of target arrival.
const WINDOW_MINUTES = 15; // Must match the pg_cron interval.
const MIN_DIFF_MINUTES = 10; // Below this, the change is not worth a push.

interface CommuteProfileRow {
  id: string;
  device_id: string;
  label: string;
  origin_label: string;
  origin_lat: number;
  origin_lng: number;
  destination_label: string;
  destination_lat: number;
  destination_lng: number;
  target_arrival_time: string;
  transport_mode: string;
  morning_brief_enabled: boolean;
  baseline_leave_time: string | null;
  devices: { expo_push_token: string | null } | null;
}

interface ProfileOutcome {
  profileId: string;
  notified: boolean;
}

// -----------------------------------------------------------------------------
// Time helpers. All wall-clock reasoning happens in APP_TIMEZONE, never in the
// server's own zone (Deno Deploy runs UTC) and never via Postgres NOW()::time,
// which would compare a UTC clock against Manila-local arrival times and be
// eight hours out.
// -----------------------------------------------------------------------------

function zonedParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

function minutesOfDay(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** "YYYY-MM-DD" for the given instant, in the given zone. */
function isoDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function isWeekday(date: Date, timeZone: string): boolean {
  const day = zonedParts(date, timeZone).weekday;
  return day !== "Sat" && day !== "Sun";
}

/** "09:00" or "09:00:00" -> minutes since midnight. */
function timeToMinutes(value: string): number | null {
  const [h, m] = value.split(":");
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function format12Hour(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Shortest signed distance between two minute-of-day values, in [-720, 720].
 * Positive means `a` is earlier than `b`. Wrap-aware so a recommendation that
 * crosses midnight does not read as a 23-hour swing.
 */
function signedMinuteDiff(a: number, b: number): number {
  let diff = b - a;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

/** True when `target` lies in [start, start + span), wrapping at midnight. */
function withinWindow(target: number, start: number, span: number): boolean {
  const offset = ((target - start) % 1440 + 1440) % 1440;
  return offset < span;
}

function buildWeatherReason(weather: string, originLabel: string): string {
  switch (weather) {
    case "rain":
      return `Rain near ${originLabel} is adding time to your usual commute`;
    case "heavy_rain":
      return `Heavy rain near ${originLabel} is significantly affecting travel times`;
    case "storm":
      return `Storm conditions near ${originLabel} — allow extra time`;
    default:
      return `Traffic is heavier than usual on your route`;
  }
}

async function fetchWeather(lat: number, lng: number): Promise<WeatherCondition> {
  // Same classification as calculate-trip, including the silent fallback: a
  // weather outage must not cost anyone their Morning Brief.
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weathercode&timezone=auto`
    );
    if (!res.ok) return "clear";
    const data = await res.json();
    const code = data?.current?.weathercode ?? -1;
    if (code >= 95) return code >= 96 ? "storm" : "heavy_rain";
    if (code >= 80 || (code >= 51 && code <= 67)) return "rain";
    return "clear";
  } catch {
    return "clear";
  }
}

Deno.serve(async (req) => {
  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== CRON_SECRET) {
    console.warn('[morning-brief] Unauthorized — secret mismatch or missing. Received:', cronSecret ? `${cronSecret.slice(0, 6)}…` : 'MISSING');
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();

  // Weekdays only. pg_cron fires daily; the day filter lives here so the
  // schedule stays simple and the rule is visible in one place.
  if (!isWeekday(now, APP_TIMEZONE)) {
    return new Response(
      JSON.stringify({ processed: 0, notified: 0, skipped: 0, reason: "weekend" }),
      { status: 200 }
    );
  }

  const nowMinutes = minutesOfDay(now, APP_TIMEZONE);
  const today = isoDate(now, APP_TIMEZONE);

  // ---------------------------------------------------------------------------
  // Step A - eligible profiles.
  //
  // The reference query is:
  //
  //   SELECT cp.*, d.expo_push_token
  //   FROM commute_profiles cp
  //   JOIN devices d ON d.id = cp.device_id
  //   WHERE cp.morning_brief_enabled = true
  //     AND d.expo_push_token IS NOT NULL
  //     AND EXTRACT(DOW FROM NOW()) BETWEEN 1 AND 5
  //     AND (cp.target_arrival_time - INTERVAL '90 minutes')::time
  //         BETWEEN NOW()::time AND (NOW() + INTERVAL '15 minutes')::time
  //     AND NOT EXISTS (
  //       SELECT 1 FROM morning_brief_log mbl
  //       WHERE mbl.commute_profile_id = cp.id AND mbl.sent_at >= NOW()::date
  //     )
  //
  // supabase-js cannot execute raw SQL, so the join and the boolean filters run
  // through PostgREST and the three time-dependent predicates are evaluated
  // here. That is not merely a translation convenience: NOW()::time on the
  // database is UTC, while target_arrival_time is Manila wall-clock, so the
  // BETWEEN above would select the wrong profiles by eight hours. Doing it in
  // APP_TIMEZONE fixes that and makes the midnight wrap explicit.
  // ---------------------------------------------------------------------------
  const { data: profileRows, error: profileError } = await admin
    .from("commute_profiles")
    .select("*, devices!inner(expo_push_token)")
    .eq("morning_brief_enabled", true)
    .not("devices.expo_push_token", "is", null);

  if (profileError) {
    console.error("[morning-brief] Failed to load profiles:", profileError.message);
    return new Response(JSON.stringify({ error: "Query failed" }), { status: 500 });
  }

  const candidates = ((profileRows ?? []) as CommuteProfileRow[]).filter((p) => {
    const arrival = timeToMinutes(p.target_arrival_time);
    if (arrival === null) return false;
    return withinWindow(arrival - LEAD_MINUTES, nowMinutes, WINDOW_MINUTES);
  });

  if (candidates.length === 0) {
    return new Response(JSON.stringify({ processed: 0, notified: 0, skipped: 0 }), {
      status: 200,
    });
  }

  // Same-day dedupe. A separate read rather than a NOT EXISTS subquery, for the
  // same reason as above; scoped to today's candidates so it stays small.
  const { data: sentRows, error: logError } = await admin
    .from("morning_brief_log")
    .select("commute_profile_id")
    .in("commute_profile_id", candidates.map((p) => p.id))
    .gte("sent_at", `${today}T00:00:00${APP_UTC_OFFSET}`);

  if (logError) {
    console.error("[morning-brief] Failed to read send log:", logError.message);
    return new Response(JSON.stringify({ error: "Query failed" }), { status: 500 });
  }

  const alreadySent = new Set((sentRows ?? []).map((r: { commute_profile_id: string }) => r.commute_profile_id));
  const eligible = candidates.filter((p) => !alreadySent.has(p.id));

  // Config shared by every profile in this run - fetched once, not per profile.
  const { data: cityRows, error: cityError } = await admin.from("city_profiles").select("*");
  if (cityError || !cityRows) {
    console.error("[morning-brief] Failed to load city profiles:", cityError?.message);
    return new Response(JSON.stringify({ error: "Config unavailable" }), { status: 500 });
  }

  const { data: versionRow, error: versionError } = await admin
    .from("recommendation_versions")
    .select("*")
    .eq("is_active", true)
    .single();
  if (versionError || !versionRow) {
    console.error("[morning-brief] No active recommendation_versions row");
    return new Response(JSON.stringify({ error: "Config unavailable" }), { status: 500 });
  }

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

  const results: ProfileOutcome[] = [];

  for (const profile of eligible) {
    // One profile's failure must never abort the run - the rest of the city is
    // still waiting on their brief.
    try {
      const arrivalMinutes = timeToMinutes(profile.target_arrival_time);
      if (arrivalMinutes === null) continue;

      const cityCode = detectCity(profile.origin_lat, profile.origin_lng, cityBoundaries);
      if (!cityCode) {
        console.error(
          `[morning-brief] Origin outside supported cities profileId=${profile.id} deviceId=${profile.device_id}`
        );
        continue;
      }
      const cityProfileRow = cityRows.find((c: any) => c.city_code === cityCode);
      if (!cityProfileRow) continue;

      const { data: transportRow } = await admin
        .from("transport_profiles")
        .select("routing_mode")
        .eq("mode_key", profile.transport_mode)
        .single();
      if (!transportRow) {
        console.error(
          `[morning-brief] Unsupported transport mode "${profile.transport_mode}" profileId=${profile.id} deviceId=${profile.device_id}`
        );
        continue;
      }

      const weatherCondition = await fetchWeather(profile.origin_lat, profile.origin_lng);

      const routeResult = await getRouteEta({
        originLat: profile.origin_lat,
        originLng: profile.origin_lng,
        destLat: profile.destination_lat,
        destLng: profile.destination_lng,
        travelMode: transportRow.routing_mode,
        apiKey: GOOGLE_API_KEY,
      });

      // No route, no brief. A recommendation built on a stale or guessed ETA is
      // worse than silence for something that wakes a person up.
      if (!routeResult.success) {
        console.error(
          `[morning-brief] Routes failed (${routeResult.errorType}) profileId=${profile.id} deviceId=${profile.device_id}: ${routeResult.message}`
        );
        continue;
      }

      const targetTime = `${today}T${minutesToTime(arrivalMinutes)}:00${APP_UTC_OFFSET}`;

      const engineResult = calculateDepartureTime({
        originHash: encodeGeohash(profile.origin_lat, profile.origin_lng, 7),
        destinationHash: encodeGeohash(profile.destination_lat, profile.destination_lng, 7),
        cityCode,
        transportMode: profile.transport_mode,
        planningMode: "arrive_by",
        targetTime,
        calculationTime: now.toISOString(),
        weatherCondition,
        rawGoogleEtaSeconds: routeResult.durationSeconds,
        dataFreshness: "live",
        recommendationVersion: versionRow.buffer_config,
        cityProfile: {
          cityCode: cityProfileRow.city_code,
          timezone: cityProfileRow.timezone,
          rushHourConfig: cityProfileRow.rush_hour_config,
          weatherSensitivity: cityProfileRow.weather_sensitivity,
        },
      });

      const leaveDate = new Date(engineResult.recommendedLeaveTime);
      const leaveMinutes = minutesOfDay(leaveDate, APP_TIMEZONE);
      const leaveTime = minutesToTime(leaveMinutes);

      const baselineMinutes =
        profile.baseline_leave_time === null ? null : timeToMinutes(profile.baseline_leave_time);

      // Positive = leaving earlier than usual.
      const diffMinutes = baselineMinutes === null ? 0 : signedMinuteDiff(leaveMinutes, baselineMinutes);
      const isFirstBrief = baselineMinutes === null;
      const shouldNotify = isFirstBrief || Math.abs(diffMinutes) >= MIN_DIFF_MINUTES;

      let notified = false;

      if (shouldNotify && profile.devices?.expo_push_token) {
        // On the first brief there is no "usual" to compare against, so the
        // title drops the comparison rather than claiming a 0-minute change.
        const diffText =
          diffMinutes > 0
            ? `${diffMinutes} min earlier than usual`
            : `${Math.abs(diffMinutes)} min later than usual`;
        const title = isFirstBrief
          ? `🚗 Leave by ${format12Hour(leaveMinutes)} this morning`
          : `🚗 Leave by ${format12Hour(leaveMinutes)} this morning (${diffText})`;

        const message = {
          to: profile.devices.expo_push_token,
          title,
          body:
            `${profile.origin_label} → ${profile.destination_label} · ` +
            `${engineResult.confidenceScore}% confidence\n` +
            `Reason: ${buildWeatherReason(weatherCondition, profile.origin_label)}`,
          sound: "default",
          data: { type: "morning_brief", profileId: profile.id },
        };

        try {
          const expoResponse = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(message),
          });

          const expoBody = await expoResponse.json().catch(() => null);
          // Expo answers 200 with a per-ticket error status, so an ok response
          // is not on its own proof the push was accepted.
          const ticketStatus = expoBody?.data?.status;
          if (expoResponse.ok && ticketStatus !== "error") {
            notified = true;
          } else {
            console.error(
              `[morning-brief] Expo push rejected profileId=${profile.id} deviceId=${profile.device_id}:`,
              JSON.stringify(expoBody ?? { status: expoResponse.status })
            );
          }
        } catch (err) {
          console.error(
            `[morning-brief] Expo push failed profileId=${profile.id} deviceId=${profile.device_id}:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      // Step E - baseline and log are written whether or not the push landed,
      // so tomorrow compares against today's real answer and the dedupe holds.
      const { error: updateError } = await admin
        .from("commute_profiles")
        .update({ baseline_leave_time: leaveTime })
        .eq("id", profile.id);
      if (updateError) {
        console.error(
          `[morning-brief] Baseline update failed profileId=${profile.id} deviceId=${profile.device_id}: ${updateError.message}`
        );
      }

      const { error: insertError } = await admin.from("morning_brief_log").insert({
        device_id: profile.device_id,
        commute_profile_id: profile.id,
        recommended_leave_time: leaveTime,
        baseline_leave_time: profile.baseline_leave_time,
        diff_minutes: isFirstBrief ? null : diffMinutes,
        notification_sent: notified,
      });
      if (insertError) {
        console.error(
          `[morning-brief] Log insert failed profileId=${profile.id} deviceId=${profile.device_id}: ${insertError.message}`
        );
      }

      results.push({ profileId: profile.id, notified });
    } catch (err) {
      console.error(
        `[morning-brief] Unhandled failure profileId=${profile.id} deviceId=${profile.device_id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return new Response(
    JSON.stringify({
      processed: results.length,
      notified: results.filter((r) => r.notified).length,
      skipped: results.filter((r) => !r.notified).length,
    }),
    { status: 200 }
  );
});
