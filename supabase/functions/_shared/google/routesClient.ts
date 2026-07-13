export type RouteApiResult =
  | {
      success: true;
      durationSeconds: number;
      distanceMeters: number;
      encodedPolyline?: string;
      rawResponse: unknown;
    }
  | {
      success: false;
      errorType: "NO_ROUTE_FOUND" | "TIMEOUT" | "API_ERROR" | "INVALID_RESPONSE";
      message: string;
    };

export interface GetRouteEtaParams {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  travelMode: string;
  apiKey: string;
  timeoutMs?: number;
}

const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DEFAULT_TIMEOUT_MS = 8000;

export async function getRouteEta(
  params: GetRouteEtaParams
): Promise<RouteApiResult> {
  const { originLat, originLng, destLat, destLng, travelMode, apiKey, timeoutMs } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode,
        computeAlternativeRoutes: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        errorType: "API_ERROR",
        message: `Google Routes API returned ${response.status}: ${body}`,
      };
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      return {
        success: false,
        errorType: "NO_ROUTE_FOUND",
        message: "Google Routes API returned zero routes for this origin/destination/mode.",
      };
    }

    const route = data.routes[0];
    const durationStr: string | undefined = route.duration;
    const distanceMeters: number | undefined = route.distanceMeters;

    if (!durationStr || typeof distanceMeters !== "number") {
      return {
        success: false,
        errorType: "INVALID_RESPONSE",
        message: "Google Routes API response is missing expected duration/distanceMeters fields.",
      };
    }

    const durationSeconds = parseInt(durationStr.replace("s", ""), 10);
    const encodedPolyline: string | undefined = route.polyline?.encodedPolyline;
    return {
      success: true,
      durationSeconds,
      distanceMeters,
      encodedPolyline,
      rawResponse: data,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return {
        success: false,
        errorType: "TIMEOUT",
        message: `Google Routes API did not respond within ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`,
      };
    }
    return {
      success: false,
      errorType: "API_ERROR",
      message: err.message ?? "Unknown network error calling Google Routes API.",
    };
  }
}


