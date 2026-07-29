# Airylio Security Configuration

Security that lives outside the codebase. Anything here has to be set in a
dashboard, so it cannot be verified by reading the repo — this file records what
the required state is, so it can be checked deliberately.

Project ref: `nxlbbmkdduzzvlcgfjif` (Airylio, ap-southeast-1)
Android package: `com.daryljm.airylio`

---

## 1. API keys — where each one lives

| Key | Where it runs | Exposed to users? |
|---|---|---|
| `GOOGLE_ROUTES_API_KEY` | Edge function only (`Deno.env`) | No — never leaves the server |
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | Mobile client | **Yes — extractable from the APK** |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Mobile client | Yes, by design — safe only if RLS is correct |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge function only | No — must never reach the client |

Every `EXPO_PUBLIC_*` variable is compiled into the JS bundle. Treat all of them
as public. The only thing standing between the Places key and someone else's
billing is the restriction config below.

---

## 2. Google Cloud Console — required restrictions

The Places key is called directly from the app, so it can be pulled out of the
APK in minutes. Unrestricted, it can be used by anyone against your billing
account until you notice.

**Places key — `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`**

APIs & Services → Credentials → select the key:

- **Application restrictions:** Android apps
  - Package name: `com.daryljm.airylio`
  - SHA-1 currently in use:
    `38:8E:37:80:5E:6A:61:51:B3:19:38:29:21:91:82:6F:9C:18:12:77`
    (a signing-certificate fingerprint is not a secret — it can be read from
    any copy of the APK — so recording it here is safe)
  - To re-derive it, or after a credential rotation:
    ```
    eas credentials --platform android
    ```
    Read the SHA-1 from the keystore it reports. A debug-keystore SHA-1 will not
    match production builds.
  - Add the debug SHA-1 as a second entry if you want dev builds to work.
- **API restrictions:** Restrict key → **Places API (New)** only.

**Routes key — `GOOGLE_ROUTES_API_KEY`**

- **Application restrictions:** **None** (or IP, if Supabase egress IPs are stable)
- **API restrictions:** Restrict key → **Routes API** only

> ⚠️ **Never put Android restrictions on this key.** It is called by the edge
> function, which is a server — it has no package name and no signing
> certificate, so Google rejects every request:
>
> ```
> 403 PERMISSION_DENIED
> reason: API_KEY_ANDROID_APP_BLOCKED
> "Requests from this Android client application <empty> are blocked."
> ```
>
> Every trip calculation then fails with a 502. This happened on 2026-07-28
> when the Android restriction intended for the Places key was applied to this
> one as well.
>
> The rule: Android restrictions are correct for keys the **app** calls, and
> always break keys the **server** calls.

Never reuse one key for both. The client key must not be able to call Routes.

### Verify

```bash
# Should FAIL once restrictions are correct (no matching package/SHA-1):
curl -s "https://places.googleapis.com/v1/places:autocomplete" \
  -H "Content-Type: application/json" \
  -H "X-Goog-Api-Key: <places-key>" \
  -H "X-Goog-FieldMask: suggestions.placePrediction.placeId" \
  -d '{"input":"manila"}'
```

A `200` from a plain curl means the key is unrestricted and usable by anyone.

---

## 3. Billing alerts

Restrictions reduce abuse; they do not cap spend. A bug or a leaked key can
still run up a bill, so set a ceiling.

Cloud Console → Billing → Budgets & alerts → Create budget:

- Scope: the Airylio project
- Amount: your expected monthly spend (start low — you can raise it)
- Thresholds: alerts at **50%, 90%, 100%** of budget
- Email the project owner

Also cap per-API usage — APIs & Services → Places API → Quotas → set a daily
request limit. A budget alert tells you after the money is spent; a quota stops
it. Set both.

Supabase: Settings → Billing → spend cap, so a traffic spike cannot run up
edge-function invocations without limit.

---

## 4. Supabase row level security

Policies are in `supabase/migrations/20260728000000_enable_rls.sql`. To audit
current state without changing anything, run `supabase/verify-rls.sql` in the
SQL editor.

Required end state:

| Table | Client access |
|---|---|
| `trips` | SELECT own rows only (`device_id = auth.uid()`) |
| `feedback` | INSERT only, and only for a trip the user owns |
| `devices` | SELECT own row |
| `calculation_events` | None |
| `route_cache`, `corridor_stats`, `city_profiles`, `transport_profiles`, `recommendation_versions` | None |

The edge function uses the service role and bypasses RLS, so none of this
affects it.

**Status (2026-07-28): verified against the live database.**

RLS is enabled on all eight public tables, and the ownership policies are
correct:

- `trips` — `SELECT USING (auth.uid() = device_id)`. Trip history is properly
  scoped. **No data leak.**
- `feedback` — INSERT and SELECT both gated on owning the referenced trip.
  `feedback` has no `device_id` of its own, so the subquery through `trips` is
  the correct mechanism.
- `devices`, `calculation_events` — scoped to `auth.uid()`.
- `route_cache` — RLS on with zero policies, i.e. deny-all. Cache poisoning is
  not possible.

Three gaps found, addressed in the migration:

1. `trips_insert_own` let clients write their own trip rows. Nothing in the app
   does — the edge function writes under the service role.
2. `calculation_events_insert_own` — same, for analytics.
3. `city_profiles`, `transport_profiles` and `recommendation_versions` had
   `USING (true)` SELECT policies, exposing rush-hour windows, weather
   sensitivity and buffer configuration to anyone with the anon key. No client
   code reads these tables.

When reading the "permissive policies" query, note that INSERT policies always
show a null `USING` clause — that is expected, not a finding. They are
constrained by `WITH CHECK`. Only `USING (true)` is a real exposure.

**Open question:** `corridor_stats` did not appear in the public schema, but
the edge function reads it ([calculate-trip/index.ts:157](functions/calculate-trip/index.ts))
in its fallback path when the Google Routes call fails. If the table is
genuinely missing, that fallback can never produce an estimate and every
Google failure becomes a 502 for the user. Worth confirming.

`trips` rows hold `origin_lat/lng` and `destination_lat/lng` — effectively home
and workplace coordinates. If RLS on `trips` is off or permissive, any
anonymous user can read every user's movements. This is the single highest-risk
item in the system.

---

## 5. Anonymous authentication

Sign-in is anonymous (`supabase.auth.signInAnonymously()`); there are no
passwords or PII. `auth.uid()` is the device identity and is stored as
`trips.device_id`.

Consequences worth knowing:

- Anyone can mint sessions, so anonymous sign-in cannot be a rate limit.
  Throttling has to be per-device inside the edge function.
- Losing the session means losing history — there is no recovery path.
- Reinstalling the app produces a new identity and empty history.
