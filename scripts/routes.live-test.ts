import { getRouteEta } from "../google/routesClient";

async function main() {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_ROUTES_API_KEY not set");
    process.exit(1);
  }

  const result = await getRouteEta({
    originLat: 14.6560,
    originLng: 121.0300,
    destLat: 14.5547,
    destLng: 121.0244,
    travelMode: "DRIVE",
    apiKey,
  });

  console.log(JSON.stringify(result, null, 2));
}

main();
