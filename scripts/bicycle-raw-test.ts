async function main() {
  const SUPABASE_URL = "https://nxlbbmkdduzzvlcgfjif.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bGJibWtkZHV6enZsY2dmamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDE0NTYsImV4cCI6MjA5ODk3NzQ1Nn0.YAexQyZ4DW5L4Nq3Jg9GRRt0208AgN3-N3qAI9RnPIE";

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const authData = await authRes.json();
  const accessToken = authData.access_token;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/calculate-trip`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      originLat: 14.6560, originLng: 121.0300,
      destLat: 14.5547, destLng: 121.0244,
      arrivalTarget: new Date(Date.now() + 3600000).toISOString(),
      transportMode: "bicycle",
    }),
  });

  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}

main();
