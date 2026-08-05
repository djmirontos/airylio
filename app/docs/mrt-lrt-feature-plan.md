# MRT/LRT Rail Integration — Feature Plan & Roadmap

> Living document. Update as implementation progresses.
> Created: 2026-08-05

---

## 1. Overview

### Problem
Filipino commuters using Airylio's Commute mode get a generic Google
Transit ETA that does not account for:
- MRT/LRT queue times during peak hours
- Platform congestion
- Accurate inter-station travel times
- Door-to-door breakdown including walking legs

### Solution
Enhance the existing Commute mode with automatic rail route detection
and evaluation. When MRT/LRT is the fastest option for a given
origin-destination pair, Airylio automatically uses it and shows a
full journey breakdown. No separate menu. No extra user decisions.

### Design Principles
- One Commute button — user never chooses between jeepney or train
- Auto-detect rail when it's faster
- Show full door-to-door breakdown in result screen
- Account for Philippine-specific realities (queue time, heat, broken pavements)
- Graceful fallback to ground transit when rail is not applicable

---

## 2. User Experience

### What the User Does
1. Enter origin
2. Enter destination
3. Select Commute mode
4. Tap Calculate

That's it. No extra steps.

### What Airylio Does Behind the Scenes
1. Check if any MRT/LRT station is within 1km of origin
2. Check if any MRT/LRT station is within 1km of destination
3. If both found — evaluate rail route
4. Compare rail ETA vs Google Transit ETA
5. Return the faster option with full breakdown

### Result Screen — Ground Transit

```
Leave at 7:12 AM
Arrive by 8:28 AM — 88% confidence

Your commute
🚌 Bus/Jeepney to destination        68 min
⚠️ Rush hour traffic added           +8 min

Total: 76 min
Via: Ground transit
```

### Result Screen — Pure Rail

```
Leave at 7:12 AM
Arrive by 8:28 AM — 91% confidence

Your commute
🚶 Walk to Cubao MRT                  8 min
⏳ Wait for train                     4 min
🚇 MRT-3 → Ayala                     22 min
🚶 Walk to destination                6 min

Total: 40 min
⚠️ Rush hour queue added: +5 min
Via: MRT-3
```

### Result Screen — Hybrid (Feeder + Rail)

```
Leave at 7:12 AM
Arrive by 8:45 AM — 86% confidence

Your commute
🚌 Jeepney to Cubao MRT              25 min
⏳ Wait for train                     4 min
🚇 MRT-3 → Ayala                     22 min
🚶 Walk to destination                6 min

Total: 57 min
⚠️ Rush hour added: +8 min
Via: Jeepney + MRT-3
```

---

## 3. Technical Architecture

### Detection Logic — Two-Stage

**Stage 1 — Cheap pre-filter (no API call)**
- Use straight-line distance to eliminate stations beyond 1.2km
- Pure math, zero cost
- Returns 0-3 candidate stations in most cases

**Stage 2 — Accurate walking time (Google Routes API)**
- Call Google Routes walking mode for candidate stations only
- Keep stations where actual walking time ≤ 15 minutes
- 15 min walk ≈ 1km in Metro Manila conditions (heat, broken pavements,
  overpasses, vendor stalls)
- Cache result per geohash for 24 hours to minimize repeat API calls

### Route Evaluation — Three Options

**Option A — Pure Rail**
- Both origin AND destination within 1km of stations on same/connected line
- Calculate: walk + queue + ride + transfer (if needed) + walk
- Uses internal station database — NOT Google

**Option B — Pure Ground Transit**
- No nearby stations OR rail is slower
- Uses Google TRANSIT mode (current behavior)
- Applies existing rush hour buffer and weather multiplier

**Option C — Hybrid (Feeder + Rail)**
- Origin NOT near a station
- Destination IS near a station
- Calculate: Google Transit to nearest origin-side station + rail segment + walk
- Only recommended if meaningfully faster than pure ground transit (>10 min saved)

**Winner = lowest total ETA** after all buffers applied.

### Walking Distance Rationale
- Maximum: 1km / 15 minutes walking
- Rationale: Metro Manila sidewalks are not walkable like Singapore or Tokyo
  Broken pavements, no shade at 35°C, vendor stalls, overpass climbs,
  flood-prone underpasses. 1km in Metro Manila feels like 2km elsewhere.
- Filipino commuters prefer tricycle/jeepney to station over 1km walk

### Confidence Score Baselines
| Route Type | Confidence Baseline | Rationale |
|---|---|---|
| Pure Rail | 88 | Fixed route, predictable headways |
| Hybrid | 82 | Ground transit leg adds variability |
| Ground Transit | 75 | Unchanged from current |

Peak hour queue uncertainty reduces confidence by up to -5 points.

### Caching Strategy
- Walk time from geohash area to nearby stations: 24-hour TTL
- Rail ETA for a corridor: 10-minute TTL (same as existing route_cache)
- Prevents repeat Google API calls for same-area users

---

## 4. Database Schema

### New Tables Required

#### train_stations
```sql
CREATE TABLE train_stations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line                  text NOT NULL, -- 'MRT3', 'LRT1', 'LRT2'
  name                  text NOT NULL,
  sequence              integer NOT NULL,
  lat                   numeric NOT NULL,
  lng                   numeric NOT NULL,
  is_transfer_station   boolean DEFAULT false,
  created_at            timestamptz DEFAULT now(),
  UNIQUE (line, sequence)
);
```

#### train_segments
```sql
CREATE TABLE train_segments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line                  text NOT NULL,
  from_station_id       uuid REFERENCES train_stations(id),
  to_station_id         uuid REFERENCES train_stations(id),
  avg_seconds           integer NOT NULL, -- average travel time
  UNIQUE (from_station_id, to_station_id)
);
```

#### train_transfers
```sql
CREATE TABLE train_transfers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_station_id       uuid REFERENCES train_stations(id),
  to_station_id         uuid REFERENCES train_stations(id),
  walk_seconds          integer NOT NULL,
  notes                 text -- e.g. 'Overpass walk, adds time in rain'
);
```

#### train_queue_penalties
```sql
CREATE TABLE train_queue_penalties (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id            uuid REFERENCES train_stations(id),
  peak_type             text NOT NULL, -- 'AM_PEAK', 'PM_PEAK'
  peak_start            time NOT NULL,
  peak_end              time NOT NULL,
  penalty_seconds       integer NOT NULL,
  notes                 text
);
```

---

## 5. Engine Changes

### New Input Type
```ts
interface RailLeg {
  type: 'walk' | 'wait' | 'ride' | 'transfer';
  label: string;        // e.g. 'Walk to Cubao MRT', 'MRT-3 → Ayala'
  seconds: number;
  line?: string;        // 'MRT3', 'LRT1', 'LRT2'
}

interface RailRoute {
  legs: RailLeg[];
  totalSeconds: number;
  queuePenaltySeconds: number;
  via: string;          // e.g. 'MRT-3' or 'Jeepney + MRT-3'
  routeType: 'rail' | 'hybrid' | 'ground';
}
```

### New Output Fields
```ts
// Added to CalculateDepartureResult
commuteBreakdown?: RailLeg[];
commuteVia?: string;
commuteRouteType?: 'rail' | 'hybrid' | 'ground';
```

---

## 6. Edge Function Changes

### New Flow for Commute Mode

```
Existing flow (all modes)
↓
If transport_mode === 'public_commute'
↓
Stage 1: Find stations within 1.2km of origin + destination
↓
Stage 2: Google walking API for candidates (cache 24h)
↓
Evaluate Option A (rail), B (ground), C (hybrid)
↓
Pick fastest → pass to engine with railRoute metadata
↓
Engine returns result with commuteBreakdown
↓
Return to client with breakdown in response
```

### Fallback Behavior
- If rail detection fails for any reason → fall back to current
  Google Transit behavior silently
- Never surface rail detection errors to the user
- Log to calculation_events for debugging

---

## 7. Result Screen Changes

### New JourneyBreakdown Component
- Only renders when commuteBreakdown is present in result
- Shows each leg with icon, label, and duration
- Shows Via label and queue penalty note
- Collapses gracefully if no breakdown available

### Icons per Leg Type
| Leg Type | Icon |
|---|---|
| Walk | 🚶 |
| Wait | ⏳ |
| MRT-3 ride | 🚇 |
| LRT-1 ride | 🚇 |
| LRT-2 ride | 🚇 |
| Bus/Jeepney | 🚌 |
| Transfer walk | 🚶 |

---

## 8. Implementation Sprints

### Sprint 1 — Data Foundation
**Goal:** All station data in Supabase. No code changes.
**Tasks:**
- [ ] Create train_stations table
- [ ] Create train_segments table
- [ ] Create train_transfers table
- [ ] Create train_queue_penalties table
- [ ] Seed MRT-3 (13 stations + 12 segments)
- [ ] Seed LRT-1 (20 stations + 19 segments)
- [ ] Seed LRT-2 (13 stations + 12 segments)
- [ ] Seed transfer nodes (4 interchanges)
- [ ] Seed peak hour queue penalties (major stations)
- [ ] Enable RLS on all new tables (service role read only —
      no client-level policies; matches city_profiles and
      transport_profiles pattern from 2026-08-01 security audit.
      Do NOT add USING (true) read policy for authenticated/anon roles)
- [ ] Verify data with test queries
**Estimated effort:** 1 day

### Sprint 2 — Detection + Calculation Logic
**Goal:** Edge Function detects rail and calculates ETA.
**Tasks:**
- [ ] Add station proximity detection (Stage 1 — straight line)
- [ ] Add walking time check (Stage 2 — Google Routes walking)
- [ ] Cache walk times per geohash (24h TTL)
- [ ] Implement Option A (pure rail) ETA calculation
- [ ] Implement Option B fallback (existing behavior)
- [ ] Implement Option C (hybrid) ETA calculation
- [ ] Route comparison logic (pick fastest)
- [ ] Pass railRoute metadata to engine
- [ ] Log rail detection events to calculation_events
- [ ] Add PostHog events: rail_route_detected, rail_route_selected,
      ground_transit_selected, hybrid_route_selected
**Estimated effort:** 3-4 days

### Sprint 3 — Engine + API Response
**Goal:** Engine accepts rail input, response includes breakdown.
**Tasks:**
- [ ] Add RailLeg and RailRoute types to engine/types.ts
- [ ] Update calculateDeparture() to accept railRoute input
- [ ] Add commuteBreakdown to engine output
- [ ] Update Edge Function response to include breakdown
- [ ] Sync _shared/engine/ copies in Deno
- [ ] Update engine tests (28 existing + new rail assertions)
**Estimated effort:** 2-3 days

### Sprint 4 — Result Screen UI
**Goal:** Journey breakdown visible in app.
**Tasks:**
- [ ] Create JourneyBreakdown component
- [ ] Integrate into ResultModal
- [ ] Mode-aware display (only shows for Commute)
- [ ] Via label and queue penalty note
- [ ] Test on real MRT corridors
**Estimated effort:** 1-2 days

### Sprint 5 — Calibration
**Goal:** Queue penalties validated by real users.
**Tasks:**
- [ ] Monitor feedback ratings from MRT/LRT users
- [ ] Adjust queue penalties based on accurate/close/late ratings
- [ ] Document final calibrated values
**Estimated effort:** Ongoing

---

## 9. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Google walking API adds latency | Stage 1 pre-filter eliminates most calls. Cache 24h. |
| Inter-station times change (maintenance, new trains) | Manual update to train_segments. Rare. |
| Queue penalty estimates are wrong initially | Sprint 5 calibration via user feedback |
| Transfer walk times vary by passenger speed | Use conservative (slower) estimates |
| Rail is rarely faster for short trips | Hybrid option only recommended if >10 min faster |
| Station data entry errors | Verify with test queries before going live |

---

## 10. Success Metrics (PostHog)

Track these events once rail is live:

| Event | Meaning |
|---|---|
| `rail_route_detected` | Rail was found and evaluated for this trip |
| `rail_route_selected` | Rail was faster and recommended |
| `ground_transit_selected` | Ground transit was faster |
| `hybrid_route_selected` | Hybrid was recommended |

Funnel: rail_route_detected → rail_route_selected → result_viewed → feedback_submitted

Target: >60% of rail-detected routes result in positive feedback (accurate/close).

---

## 11. Future Enhancements (Post-MVP)

- Station preference (user picks preferred boarding station)
- Beep card low balance warning integration
- Real-time train delay alerts (if DOTR API becomes available)
- Tricycle/e-trike to station leg for last-mile
- P2P bus integration (EDSA Carousel)
- Provincial bus terminals (Cubao, Pasay)

---

## 12. Data Sources

| Data | Source |
|---|---|
| Station GPS coordinates | OpenStreetMap Philippines + manual verification |
| Inter-station travel times | DOTr published schedules + community knowledge |
| Transfer walk times | Personal measurement + community validation |
| Queue penalties | Initial estimates; calibrated via user feedback |
| Operating hours | LRTA and MRTC official websites |

---

*Last updated: 2026-08-05*
*Next update: After Sprint 1 completion*
