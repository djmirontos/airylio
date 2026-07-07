const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://nxlbbmkdduzzvlcgfjif.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bGJibWtkZHV6enZsY2dmamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDE0NTYsImV4cCI6MjA5ODk3NzQ1Nn0.YAexQyZ4DW5L4Nq3Jg9GRRt0208AgN3-N3qAI9RnPIE";

function freshClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

async function run() {
  console.log("--- Airylio: Anonymous Auth + RLS Verification ---\n");

  const clientA = freshClient();

  console.log("Step 1: Signing in User A anonymously...");
  const { data: authA, error: authErrorA } = await clientA.auth.signInAnonymously();
  if (authErrorA) { console.error("FAILED: sign-in User A:", authErrorA.message); process.exit(1); }
  const userAId = authA.user.id;
  console.log("User A id:", userAId);

  console.log("\nStep 2: Creating devices row for User A...");
  const { error: deviceErrorA } = await clientA.from("devices").insert({
    id: userAId, platform: "android", app_version: "0.0.1-test",
  });
  if (deviceErrorA) { console.error("FAILED: devices insert User A:", deviceErrorA.message); process.exit(1); }
  console.log("devices row created.");

  console.log("\nStep 3: Fetching seeded recommendation_versions row...");
  const { data: version, error: versionError } = await clientA
    .from("recommendation_versions").select("id, version_label").eq("version_label", "v1.0").single();
  if (versionError) { console.error("FAILED: fetch recommendation_versions:", versionError.message); process.exit(1); }
  console.log("Using recommendation_version_id:", version.id);

  console.log("\nStep 4: Inserting a test trip as User A...");
  const now = new Date();
  const { data: trip, error: tripError } = await clientA.from("trips").insert({
    device_id: userAId,
    origin_hash: "u1x2y3z",
    destination_hash: "u1x2y3w",
    city_code: "PH-MNL",
    transport_mode: "drive",
    arrival_target: new Date(now.getTime() + 60 * 60000).toISOString(),
    raw_google_eta_seconds: 2400,
    recommended_leave_time: new Date(now.getTime() + 15 * 60000).toISOString(),
    predicted_arrival_time: new Date(now.getTime() + 55 * 60000).toISOString(),
    confidence_score: 91.5,
    weather_condition: "clear",
    data_freshness: "live",
    recommendation_version_id: version.id,
  }).select().single();
  if (tripError) { console.error("FAILED: trip insert:", tripError.message); process.exit(1); }
  console.log("Trip inserted. id:", trip.id);

  console.log("\nStep 5: User A reading back their own trip...");
  const { data: ownTrips, error: ownErr } = await clientA.from("trips").select("*").eq("id", trip.id);
  if (ownErr) { console.error("FAILED: read own trip:", ownErr.message); process.exit(1); }
  console.log(ownTrips.length === 1 ? "PASS: User A sees their own trip." : "FAIL: expected 1 row, got " + ownTrips.length);

  console.log("\nStep 6: Signing in User B anonymously (separate client)...");
  const clientB = freshClient();
  const { data: authB, error: authErrorB } = await clientB.auth.signInAnonymously();
  if (authErrorB) { console.error("FAILED: sign-in User B:", authErrorB.message); process.exit(1); }
  console.log("User B id:", authB.user.id);

  console.log("\nStep 7: User B attempting to read User A's trip (should be 0 rows)...");
  const { data: otherTrips, error: otherErr } = await clientB.from("trips").select("*").eq("id", trip.id);
  if (otherErr) { console.error("Query errored unexpectedly:", otherErr.message); process.exit(1); }
  console.log(otherTrips.length === 0
    ? "PASS: RLS isolation confirmed \u2014 User B cannot see User A's trip."
    : "FAIL: RLS isolation broken \u2014 User B saw " + otherTrips.length + " row(s).");

  console.log("\n--- Verification complete ---");
}

run();
