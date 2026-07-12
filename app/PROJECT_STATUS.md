# Airylio Project Documentation

> Single source of truth. Never delete historical information. Always append to the changelog. Update before ending any major task.

---

## 1. Project Overview

**Purpose:** AI-powered departure planning app for Philippine commuters. Tells you exactly when to leave to arrive on time.

**Vision:** "Leave on time. Arrive with confidence." — a trust instrument for daily commuters, not just a navigation tool.

**Problem being solved:** Philippine commuters face unpredictable traffic, weather, and road conditions. Most existing tools tell you how long a route takes *right now*, but not when to leave to hit a specific arrival time. Airylio solves the departure planning problem, not the navigation problem.

**Target users:** Daily commuters in Philippine cities (Metro Manila, Cebu, Davao, CDO, Iloilo, Bacolod, Baguio, GenSan) who need to arrive at a specific time and want a reliable, confident recommendation for when to leave.

---

## 2. Current Status

**Overall Progress:**

| Layer | Status |
|---|---|
| Backend (Supabase + Edge Functions) | ✅ Complete |
| Recommendation Engine | ✅ Complete |
| Mobile App (core flow) | ✅ Complete |
| UI/UX | ✅ Sprint 1 complete, Sprint 2 pending |
| Testing | ✅ Engine (28 assertions), Edge Function (live-tested) |

**Current Version:** MVP Phase 1 (pre-App Store)
**Current Branch:** `main`
**Last Updated:** 2026-07-11
**Supabase Project:** `nxlbbmkdduzzvlcgfjif`
**GitHub Repo:** https://github.com/djmirontos/airylio.git

---

## 3. Completed Features

### Anonymous Authentication + Persistent Device Identity
**Status:** ✅ Complete
**Description:** Users are silently signed in with Supabase Anonymous Auth on first launch. Session is persisted via AsyncStorage so the same `device_id` (= `auth.uid()`) is reused across app restarts. No login UI exists.
**Files modified:** `app/lib/supabase.ts`, `app/App.tsx`
**Database changes:** `devices` table, RLS on all tables via `auth.uid()`
**Dependencies:** `@supabase/supabase-js`, `@react-native-async-storage/async-storage`
**Testing performed:** SQL verification — one `device_id` with `trip_count: 2` after full app close/reopen cycle
**Commit:** `ddc60e7`
**Notes:** `signInAnonymously()` only fires when no existing session is found (`getSession()` check first).

---

### Recommendation Engine (Arrive By + Leave At)
**Status:** ✅ Complete
**Description:** Pure TypeScript function (no side effects, no DB calls). Takes origin/dest hashes, city profile, transport mode, planning mode, target time, weather, and ETA; returns recommended leave time, predicted arrival, confidence score, confidence reasons, per-factor explanation breakdown.
**Files modified:** `engine/calculateDeparture.ts`, `engine/types.ts`, `scripts/engine.test.ts`
**Planning modes:**
- `arrive_by`: buffer **subtracted** from target → `predictedArrival = target − buffer`, `leaveTime = predictedArrival − eta`
- `leave_at`: buffer **added** → `leaveTime = target` (echoed), `predictedArrival = target + eta + buffer`
**Rush-hour detection:** `arrive_by` uses `calculationTime`, `leave_at` uses `targetTime` (the actual departure moment)
**Buffer formula:** `base × weatherMultiplier × weatherSensitivity × rushHourMultiplier`, capped at mode maximum
**Confidence baseline:** per transport mode (drive: 90, motorcycle: 85, commute: 75, walk: 95); penalties for cached (−5) and estimated (−15) freshness
**Testing performed:** 28 regression assertions (4 arrive_by + 7 leave_at + factors/cap scenarios)
**Commit:** `ff5c7e6` (engine), `4001aa6` (factors)
**Notes:** Weather hardcoded to `'clear'` for V1. `factors` array provides per-factor breakdown (approximation — multiplicative cross-terms not decomposable exactly).

---

### Supabase Schema
**Status:** ✅ Complete
**Description:** Full multi-tenant schema with RLS, anonymous-auth-based device identity, route caching, corridor stats for fallback, recommendation versioning.

**Key tables:**

| Table | Purpose |
|---|---|
| `devices` | One row per anonymous device. `id` = `auth.uid()` |
| `trips` | Every calculation. Stores `planning_mode`, `target_time`, leave/arrival times, confidence, explanation |
| `feedback` | Post-trip ratings (accurate/close/late). Not yet wired to UI post-removal of premature prompt |
| `route_cache` | 10-minute TTL cache of Google Routes responses keyed by geohash+mode+time bucket |
| `corridor_stats` | Materialized view for fallback ETAs when Google is unavailable |
| `transport_profiles` | Maps app mode keys to Google routing modes |
| `recommendation_versions` | Versioned buffer config (immutable via trigger) |
| `city_profiles` | City boundaries, timezone, rush-hour windows, weather sensitivity |
| `calculation_events` | Audit log: cache hits, API calls, errors, fallbacks |

**Schema changes from V1 baseline:**
- `trips.arrival_target` renamed → `trips.target_time` (supports both modes)
- `trips.planning_mode` added (`text NOT NULL DEFAULT 'arrive_by'`, CHECK constraint)

**RLS:** All tables use `auth.uid()`. `route_cache` RLS enabled, service-role only.

---

### Edge Function: calculate-trip
**Status:** ✅ Complete
**Endpoint:** `https://nxlbbmkdduzzvlcgfjif.supabase.co/functions/v1/calculate-trip`
**Request body:**
```json
{
  "originLat": number,
  "originLng": number,
  "destLat": number,
  "destLng": number,
  "planningMode": "arrive_by" | "leave_at",
  "targetTime": "ISO 8601 string",
  "transportMode": "drive" | "motorcycle_taxi" | "public_commute" | "walk"
}
```
**Response:**
```json
{
  "tripId": "uuid",
  "recommendedLeaveTime": "ISO 8601",
  "predictedArrivalTime": "ISO 8601",
  "confidenceScore": number,
  "confidenceReason": string[],
  "recommendationExplanation": { "planningMode": string, "factors": [...] },
  "dataFreshness": "live" | "cached" | "estimated",
  "distanceMeters": number
}
```
**Flow:** Auth check → city detection → transport profile lookup → cache check → Google Routes API (or corridor_stats fallback) → engine → insert trips + calculation_events → return
**Secrets:** `GOOGLE_ROUTES_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
**Commit:** `58d6bf7`
**Notes:** `planningMode` defaults to `'arrive_by'` defensively for older clients.

---

### Mobile App — Plan Screen
**Status:** ✅ Complete
**Description:** Main planning form. Planning mode toggle, From/To autocomplete with recent destinations, prominent date/time card, transport mode selector, calculate button.
**Key components:**
- `DestinationAutocomplete` — custom component calling Google Places API (New) directly; merges Suggested + Recent in one dropdown, both From and To fields
- `TimePickerModal` — custom 12-hour modal picker (hour/minute scrollable columns, AM/PM, Now tab, Cancel/Done)
- Planning mode toggle (🚩 Arrive By / 🚀 Leave At) using Ionicons
**Files:** `app/App.tsx`, `app/components/DestinationAutocomplete.tsx`, `app/components/TimePickerModal.tsx`
**Dependencies:** `@expo-google-fonts/poppins`, `@expo-google-fonts/inter`, `@expo/vector-icons`, `react-native-svg`

---

### Mobile App — Loading Screen
**Status:** ✅ Complete
**Description:** Premium white-background animated loading screen shown while the Edge Function calculates. Built with React Native's built-in `Animated` API only (no Reanimated).
**Animations:** 3 staggered breathing concentric rings, floating car icon, fade-cycling status messages
**File:** `app/components/LoadingRecommendation.tsx`
**Notes:** Reanimated was attempted but caused runtime crashes in Expo Go (Hermes incompatibility with the v4+worklets combination). Reverted to built-in Animated permanently.

---

### Mobile App — Result Screen
**Status:** ✅ Complete
**Description:** Full-screen modal slide-up. Dark navy hero with trip stack (origin→destination), target arrival (arrive_by only), freshness badge, leave time + confidence ring + predicted arrival. Body: mode-aware explanation sentence, "Why this recommendation", "Estimated impact" (factors), "Trip details" (travel time, distance, data source).
**Mode-aware labels:**
- Arrive By: "Leave at X:XX to arrive by X:XX."
- Leave At: "If you leave at X:XX, you'll arrive around X:XX."
**File:** `app/App.tsx`
**Commit:** `71f8467`

---

### Custom Autocomplete (From + To)
**Status:** ✅ Complete
**Description:** Replaced `react-native-google-places-textinput` library entirely (both fields) with a custom component calling Google Places Autocomplete (New) API directly. Gives full control to merge Suggested + Recent in one correctly-ordered scrollable dropdown.
**File:** `app/components/DestinationAutocomplete.tsx`
**Notes:** `react-native-google-places-textinput` remains in `package.json` but is no longer used. Can be uninstalled as cleanup.
**Commit:** `937d1e1`

---

### Recent Destinations + Origins
**Status:** ✅ Complete
**Description:** Last 8 destinations and origins stored locally via AsyncStorage (separate keys). Shown in the autocomplete dropdown below Suggested results. Survives app restarts.
**Storage keys:** `airylio:recentDestinations`, `airylio:recentOrigins`
**Files:** `app/App.tsx`, `app/components/DestinationAutocomplete.tsx`

---

### Leave At Mode (Full Stack)
**Status:** ✅ Complete
**Description:** Second planning mode. User specifies departure time; engine predicts arrival. Toggle between modes via Ionicons-based segmented control at top of Plan screen.
**Layers changed:** Engine (`planningMode` + `targetTime`), Schema (`planning_mode` column, `target_time` rename), Edge Function (accepts both modes), Mobile UI (toggle, dynamic labels, mode-aware results)
**Commits:** `ff5c7e6` (engine), `58d6bf7` (backend), `937d1e1` (UI)

---

## 4. Features In Progress

### Divider color fix on LoadingRecommendation white background
**Status:** ⏳ In progress (mid-session, not yet committed)
**Current work:** Switching loading screen from dark navy to white background; text/divider colors need adjustment for dark-on-light readability
**Files involved:** `app/components/LoadingRecommendation.tsx`
**Remaining tasks:** Verify divider rgba fix landed correctly, then commit all pending UI changes

---

## 5. Pending Roadmap

| Priority | Feature | Status | Notes |
|---|---|---|---|
| High | Post-trip feedback (proper timing) | ⏳ | Removed from result screen (premature). Needs local notification at predicted arrival time, or next-session prompt |
| High | Sprint 2 "Trust" features | ⏳ | Countdown timer ("Leave in 42 min"), weather indicators, map preview |
| Medium | Favorites (Home/Work) | ⏳ | Sprint 3 |
| Medium | Trip history screen | ⏳ | Sprint 3. Bottom nav required |
| Medium | Push notifications | ⏳ | "Leave now" alert at calculated departure time |
| Medium | Live weather API | ⏳ | Weather hardcoded to 'clear' in V1. Replace with real API call |
| Medium | Dark mode | ⏳ | Low complexity once design tokens are solid |
| Low | Leave Now mode | ⏳ | Shortcut: target = now, instant calculation |
| Low | Flexible Arrival window | ⏳ | "Arrive between 8:00–8:30" |
| Low | EAS Build / App Store submission | ⏳ | Requires Expo account + build config |
| Low | Bottom navigation | ⏳ | Plan / Trips / History / Settings tabs (mocked in reference designs) |
| Low | Real user testing recruitment | ⏳ | 10–20 PH commuters for real feedback |

---

## 6. Database Documentation

### `devices`
**Purpose:** One row per anonymous device. Created on first auth, upserted on every request.
**Key columns:** `id` (uuid, PK = auth.uid()), `created_at`
**RLS:** `auth.uid() = id`

### `trips`
**Purpose:** Every calculation result. The core fact table.
**Key columns:** `id`, `device_id`, `origin_hash`, `destination_hash`, `city_code`, `transport_mode`, `planning_mode`, `target_time`, `calculation_timezone`, `raw_google_eta_seconds`, `recommended_leave_time`, `predicted_arrival_time`, `confidence_score`, `confidence_reason`, `recommendation_explanation` (JSONB), `weather_condition`, `data_freshness`, `recommendation_version_id`
**RLS:** `auth.uid() = device_id`
**Notes:** `target_time` = arrival deadline for `arrive_by`, departure time for `leave_at`

### `feedback`
**Purpose:** Post-trip accuracy ratings.
**Key columns:** `trip_id` (FK → trips), `rating` (accurate/close/late), `user_success` (bool)
**RLS:** `auth.uid()` via trip join
**Notes:** Schema exists, UI prompt removed (premature timing). Deferred to proper post-trip notification flow.

### `route_cache`
**Purpose:** Caches Google Routes API responses for 10 minutes to reduce API costs.
**Key columns:** `cache_key` (unique), `origin_hash`, `destination_hash`, `transport_mode`, `time_bucket`, `google_response` (JSONB), `expires_at`
**RLS:** Enabled, service-role only (no user-level access)

### `corridor_stats`
**Purpose:** Materialized view of average ETAs per origin→destination→mode corridor. Used as fallback when Google Routes fails.

### `transport_profiles`
**Purpose:** Maps app mode keys to Google routing mode strings.
**Example:** `motorcycle_taxi` → `TWO_WHEELER`

### `recommendation_versions`
**Purpose:** Versioned buffer config. The active row's `buffer_config` is passed to the engine on every calculation.
**Notes:** `buffer_config` is immutable via a Postgres trigger (prevents silent config changes).

### `city_profiles`
**Purpose:** Per-city configuration: boundary (lat/lng box), IANA timezone, rush-hour windows, weather sensitivity multiplier.
**Current cities:** Metro Manila (PH-MNL), Cebu, Davao, CDO, Iloilo, Bacolod, Baguio, GenSan

### `calculation_events`
**Purpose:** Audit log for every calculation step (cache_hit, google_api_success, fallback_used, no_route_found, errors).

---

## 7. Edge Functions

### `calculate-trip`
**Purpose:** The single backend function. Accepts a trip calculation request, runs the full pipeline, returns a recommendation.
**Path:** `supabase/functions/calculate-trip/index.ts`
**Shared code:** `supabase/functions/_shared/engine/`, `_shared/geo/`, `_shared/google/`
**Important:** `_shared/engine/` files are separate copies from `engine/` (deliberate — Deno requires `.ts` extensions on imports). Must be manually synced when engine changes.
**Flow:**
1. Verify auth header → get device ID
2. Upsert device
3. Parse + validate body (`planningMode`, `targetTime`, transport, coords)
4. Detect city from origin coords
5. Lookup transport routing mode
6. Check route cache
7. If cache miss → call Google Routes API; on failure → fallback to corridor_stats
8. Load active recommendation version
9. Run `calculateDepartureTime()` engine
10. Insert trip row
11. Return result

---

## 8. Recommendation Engine

**File:** `engine/calculateDeparture.ts`
**Type definitions:** `engine/types.ts`
**Tests:** `scripts/engine.test.ts` (28 assertions, 0 failures)

### Inputs (`CalculateDepartureInput`)
- `planningMode`: `'arrive_by'` | `'leave_at'`
- `targetTime`: ISO string (arrival deadline for arrive_by, departure time for leave_at)
- `calculationTime`: ISO string (when the user tapped Calculate)
- `transportMode`: string key
- `weatherCondition`: `'clear'` | `'rain'` | `'heavy_rain'` | `'storm'` (V1: always `'clear'`)
- `rawGoogleEtaSeconds`: travel time from Google Routes (or fallback)
- `dataFreshness`: `'live'` | `'cached'` | `'estimated'`
- `recommendationVersion`: buffer config from DB
- `cityProfile`: timezone, rush-hour windows, weather sensitivity

### Outputs (`CalculateDepartureResult`)
- `recommendedLeaveTime`, `predictedArrivalTime` (ISO strings)
- `confidenceScore` (0–100)
- `confidenceReason` (string[])
- `recommendationExplanation` (includes `planningMode`, `factors[]`)

### Buffer formula
```
uncapped = baseBuffer × weatherMultiplier × cityWeatherSensitivity × rushHourMultiplier
totalBuffer = min(uncapped, maxBuffer)
```

### Mode-based time calculation
- **arrive_by:** `predictedArrival = target − totalBuffer`, `leaveTime = predictedArrival − eta`
- **leave_at:** `leaveTime = target`, `predictedArrival = target + eta + totalBuffer`

### Rush-hour detection
Uses wall-clock time in the **city's IANA timezone** (not server timezone — fixed after timezone regression bug).
- `arrive_by`: checks `calculationTime` (departure is usually imminent)
- `leave_at`: checks `targetTime` (departure could be hours away)

### Confidence score
Baseline per transport mode (drive=90, motorcycle=85, commute=75, walk=95). Penalties: cached data −5, estimated data −15. Clamped to [0, 100].

### Per-factor breakdown (`factors`)
Approximation (not an exact ledger — real formula is multiplicative, factors can't be decomposed precisely). Shown as "Rain may add 8 min" etc. in the result screen.

---

## 9. Mobile App

### Plan Screen (main)
**Purpose:** The primary user-facing screen. Collect trip details, trigger recommendation.
**Components:** Planning mode toggle, From field (GPS chip / manual search), To field (search + recent), Date/Time card (prominent, accent-tinted), Transport mode pills (4 modes), Calculate button, error display
**API used:** Google Places Autocomplete (New), Supabase Edge Function
**Future improvements:** "Leave Now" shortcut, Favorites (Home/Work), trip history link

### Loading Screen
**Purpose:** Full-screen premium animated overlay while Edge Function runs.
**Component:** `LoadingRecommendation`
**Animations:** Breathing concentric rings (built-in Animated), floating car icon (Ionicons), rotating status messages with fade
**Background:** White (Apple-style), purple accent rings

### Result Screen
**Purpose:** Shows the recommendation. Full-screen modal slide-up.
**Components:** Dark navy hero (trip stack, freshness badge, leave time, confidence ring), result body (explanation sentence, why this recommendation, estimated impact, trip details)
**Mode-aware content:**
- Arrive By: shows "Target arrival" in hero, "Leave at X to arrive by Y" sentence
- Leave At: no target arrival shown (redundant), "If you leave at X, you'll arrive around Y" sentence

### Time Picker Modal
**Purpose:** Custom 12-hour time picker (replaces native DateTimePicker for time).
**Component:** `TimePickerModal`
**Features:** Live readout, Time/Now tabs, scrollable hour (1–12) + minute (0–59) columns, AM/PM toggle, Cancel/Done

---

## 10. Folder Structure

```
airylio/
├── app/                        # Expo React Native app
│   ├── App.tsx                 # Root component, all screens
│   ├── app.json                # Expo config
│   ├── babel.config.js         # { presets: ['babel-preset-expo'] } only
│   ├── lib/
│   │   └── supabase.ts         # Supabase client (persistSession: true)
│   ├── assets/                 # Images (icon.png, main_bg.png, car_complete.png, result_g.png)
│   └── components/
│       ├── ConfidenceRing.tsx          # Animated SVG ring (built-in Animated)
│       ├── DestinationAutocomplete.tsx # Custom Google Places autocomplete
│       ├── LoadingRecommendation.tsx   # Premium loading screen
│       └── TimePickerModal.tsx         # Custom 12-hour time picker
├── engine/                     # Pure TS recommendation engine (Node/tsx)
│   ├── calculateDeparture.ts
│   └── types.ts
├── geo/                        # Geospatial utilities
│   ├── geohash.ts
│   ├── detectCity.ts
│   └── cacheKey.ts
├── google/                     # Google Routes API client
│   └── routesClient.ts
├── scripts/                    # Test + live-test scripts
│   ├── engine.test.ts          # 28-assertion regression suite
│   ├── leave-at.live-test.ts   # Live Edge Function test (both modes)
│   └── edge-function.live-test.ts  # Original live test (now stale - sends arrivalTarget)
└── supabase/
    ├── migrations/             # SQL migration files
    └── functions/
        ├── calculate-trip/
        │   └── index.ts        # Edge Function
        └── _shared/            # Deno copies of engine/geo/google (must sync manually)
```

---

## 11. Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `app/.env` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `app/.env` | Supabase anon key (safe to expose) |
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | `app/.env` | Google Places API (New) — client-side, restricted by app bundle ID |
| `GOOGLE_ROUTES_API_KEY` | Supabase secrets | Google Routes API — server-side only, never exposed to client |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secrets | Admin DB access inside Edge Function |

---

## 12. Third-party Services

### Google Routes API
**Why:** Best-in-class real-time traffic ETA for Philippines. Used server-side only (via Edge Function) to protect the API key and enable caching.
**Used in:** `supabase/functions/_shared/google/routesClient.ts`

### Google Places API (New)
**Why:** Autocomplete for Philippine addresses. Used client-side. The "New" API version (vs legacy) supports `includedRegionCodes`, better structured responses, and per-session billing.
**Used in:** `app/components/DestinationAutocomplete.tsx`

### Supabase
**Why:** Auth (anonymous), Postgres DB, Edge Functions, RLS. Chosen for zero-infrastructure setup, built-in anonymous auth matching the no-login design, and tight integration between auth identity and DB row-level security.

### Expo / React Native
**Why:** Cross-platform mobile (iOS + Android) from one codebase. Expo Go enables live testing without native builds, matching the no-admin-rights development constraint.

### Weather API
**Why:** Not yet integrated. V1 hardcodes `'clear'`. Intended for Sprint 2.

---

## 13. Known Issues

| Issue | Severity | Notes |
|---|---|---|
| `react-native-google-places-textinput` still in `package.json` | Low | No longer used. Safe to `npm uninstall` as cleanup |
| `scripts/edge-function.live-test.ts` sends stale `arrivalTarget` field | Low | Old test script, now fails with 400. Replace with `leave-at.live-test.ts` |
| `app/assets/result_ g.png` has a space in filename | Low | Stale filename, not yet wired to UI |
| Post-trip feedback timing | Medium | `feedback` table exists but UI prompt removed (premature). No proper trigger yet |
| Weather hardcoded to `'clear'` | Medium | Engine accepts weather as a parameter but V1 never varies it |
| Tunnel testing blocked on ship WiFi | Low | Ship content filter blocks `*.exp.direct`. Use mobile data for Expo Go testing |
| `recentOrigins` empty until user searches | Info | Expected behavior, not a bug. First launch shows no recent origins |

---

## 14. Changelog

### 2026-07-12
- Committed and pushed Sprint 1 UI changes (TimePickerModal, planning mode toggle, white loading screen bg)

### 2026-07-11
- Added `TimePickerModal` custom 12-hour time picker component
- Replaced corrupted emoji in mode toggle with Ionicons (`flag`, `rocket`)
- Switched loading screen background from dark navy to white (Apple-style)
- Added planning mode toggle (🚩 Arrive By / 🚀 Leave At) as first-class UI feature
- Dynamic date/time section labels per planning mode
- Prominent accent-tinted date/time card (main focal point)
- Mode-aware result screen labels and natural-language explanation sentence
- Fixed broken `arrivalTarget` payload → renamed to `targetTime` + `planningMode`
- Result screen enriched: trip stack (origin→destination), target arrival, travel time, distance, data source
- Back arrow replaced close X on result screen (addresses text truncation)
- Feedback prompt removed from result screen (premature timing)
- Logo + `main_bg.png` background added to header
- `DestinationAutocomplete` component: custom Google Places integration for both From and To fields, merges Suggested + Recent in unified dropdown
- Leave At mode deployed end-to-end: engine (28 tests), schema migration, Edge Function, mobile UI
- Schema: `trips.arrival_target` renamed to `trips.target_time`, `trips.planning_mode` added
- Per-factor explanation breakdown (`factors`) added to engine output and result screen
- Persistent anonymous identity via AsyncStorage session persistence
- Recent destinations (8 each for origins and destinations) stored locally

### 2026-07-08
- Premium UI redesign: Poppins + Inter typography, ink/accent/signal color palette
- Confidence ring (animated SVG) on result screen
- Loading screen: premium animated dark modal with breathing rings and rotating messages (later revised to white background)
- Custom time picker modal with scrollable columns
- Feedback collection (accurate/close/late) — later removed from result screen, schema preserved
- Google Places Autocomplete integrated (custom, replacing library)
- Tap-to-dismiss keyboard (`TouchableWithoutFeedback`)
- Transport mode pills (Drive/Motorcycle/Commute/Walk — Bicycle removed, no Google Routes coverage)
- Initial MVP flow: From/To/Date/Time/Transport → Calculate → Result

### 2026-07-07 (earlier session)
- Edge Function `calculate-trip` deployed and verified live
- Supabase schema created (all tables, RLS, triggers, materialized view)
- Recommendation engine V1: arrive_by mode, buffer calculation, confidence scoring
- Anonymous Auth, device identity
- Google Routes API integration (server-side)
- Geohash-based caching (precision 7, 10-minute TTL)
- City detection (8 PH cities, bounding-box + priority)

---

## 15. Next Recommended Tasks

| Priority | Task | Notes |
|---|---|---|
| 2 | Sprint 2 "Trust" features | Countdown timer, weather indicator, confidence visualization improvement |
| 3 | Post-trip feedback — proper timing | Local notification at predicted arrival, or next-session prompt |
| 4 | Live weather API integration | Replace hardcoded `'clear'` with real weather data |
| 5 | Favorites (Home/Work shortcuts) | AsyncStorage, pre-populated in destination autocomplete |
| 6 | Trip history screen | Requires bottom navigation, reads from `trips` table |
| 7 | Push notifications | "Leave now" alert at calculated departure time |
| 8 | Real user testing recruitment | 10–20 PH commuters, Facebook groups / WhatsApp communities |
| 9 | App Store preparation | EAS Build setup, icons, splash screen, store listing |
| 10 | Uninstall unused `react-native-google-places-textinput` package | Cleanup |



