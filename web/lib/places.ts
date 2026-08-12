const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY!;

export interface PlaceSuggestion {
  placeId: string;
  label: string;
  description: string;
}

export async function fetchSuggestions(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  if (!input || input.length < 2) return [];
  try {
    const res = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
        },
        body: JSON.stringify({
          input,
          sessionToken,
          includedRegionCodes: ['ph'],
          languageCode: 'en',
        }),
      }
    );
    const data = await res.json();
    return (data.suggestions ?? [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => ({
        placeId: s.placePrediction.placeId,
        label: s.placePrediction.structuredFormat?.mainText?.text ?? s.placePrediction.text.text,
        description: s.placePrediction.text.text,
      }));
  } catch {
    return [];
  }
}

/**
 * Routed through /api/place-details rather than straight to Google: the Places
 * API returns no CORS headers, so a browser request to it is blocked before the
 * response is ever read. Signature is unchanged, so no call site moves.
 */
export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const params = new URLSearchParams({ placeId, sessionToken });
    const res = await fetch(`/api/place-details?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.lat) return null;
    return { lat: data.lat, lng: data.lng, label: data.label };
  } catch {
    return null;
  }
}
