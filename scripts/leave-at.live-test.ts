import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nxlbbmkdduzzvlcgfjif.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bGJibWtkZHV6enZsY2dmamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDE0NTYsImV4cCI6MjA5ODk3NzQ1Nn0.YAexQyZ4DW5L4Nq3Jg9GRRt0208AgN3-N3qAI9RnPIE";

async function main() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: authError } = await client.auth.signInAnonymously();
  if (authError) { console.error("Auth failed:", authError.message); process.exit(1); }

  console.log("=== Test 1: arrive_by mode (should behave exactly as before) ===");
  const { data: arriveByData, error: arriveByError } = await client.functions.invoke("calculate-trip", {
    body: {
      originLat: 14.6560, originLng: 121.0300,
      destLat: 14.5547, destLng: 121.0244,
      planningMode: "arrive_by",
      targetTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      transportMode: "drive",
    },
  });
  if (arriveByError) {
    const bodyText = await arriveByError.context?.text?.();
    console.error("arrive_by FAILED:", bodyText || arriveByError.message);
  } else {
    console.log(JSON.stringify(arriveByData, null, 2));
  }

  console.log("\n=== Test 2: leave_at mode (new) ===");
  const departureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: leaveAtData, error: leaveAtError } = await client.functions.invoke("calculate-trip", {
    body: {
      originLat: 14.6560, originLng: 121.0300,
      destLat: 14.5547, destLng: 121.0244,
      planningMode: "leave_at",
      targetTime: departureTime,
      transportMode: "drive",
    },
  });
  if (leaveAtError) {
    const bodyText = await leaveAtError.context?.text?.();
    console.error("leave_at FAILED:", bodyText || leaveAtError.message);
  } else {
    console.log(JSON.stringify(leaveAtData, null, 2));
    console.log("\n--- Verification ---");
    console.log("Departure time sent:      ", departureTime);
    console.log("recommendedLeaveTime got: ", leaveAtData.recommendedLeaveTime);
    console.log("Match (should echo exactly):", departureTime === leaveAtData.recommendedLeaveTime);
    const leaveMs = new Date(leaveAtData.recommendedLeaveTime).getTime();
    const arriveMs = new Date(leaveAtData.predictedArrivalTime).getTime();
    console.log("Predicted arrival is AFTER leave time (buffer added, not subtracted):", arriveMs > leaveMs);
  }
}

main();
