import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nxlbbmkdduzzvlcgfjif.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bGJibWtkZHV6enZsY2dmamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDE0NTYsImV4cCI6MjA5ODk3NzQ1Nn0.YAexQyZ4DW5L4Nq3Jg9GRRt0208AgN3-N3qAI9RnPIE";

async function main() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await client.auth.signInAnonymously();
  if (authError) { console.error("Auth failed:", authError.message); process.exit(1); }

  const { data, error } = await client.functions.invoke("calculate-trip", {
    body: {
      originLat: 14.6560, originLng: 121.0300,
      destLat: 14.5547, destLng: 121.0244,
      arrivalTarget: new Date(Date.now() + 3600000).toISOString(),
      transportMode: "bicycle",
    },
  });

  if (error) { console.error("Function error:", error); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
}

main();

