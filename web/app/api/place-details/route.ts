import { NextRequest, NextResponse } from 'next/server';

// Server-only key. Google's Places API sends no CORS headers, so the browser
// cannot call it directly - this route is what makes Place Details reachable
// from the PWA. Keeping the key server-side also means it never needs an HTTP
// referrer restriction, which is what blocks the public key on production
// domains today.
const API_KEY = process.env.GOOGLE_PLACES_API_KEY_SERVER!;

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get('placeId');
  const sessionToken = req.nextUrl.searchParams.get('sessionToken');

  if (!placeId) {
    return NextResponse.json({ error: 'Missing placeId' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'location,displayName,formattedAddress',
          ...(sessionToken ? { 'X-Goog-SessionToken': sessionToken } : {}),
        },
      }
    );

    const data = await res.json();
    if (!data?.location) {
      return NextResponse.json({ error: 'No location data' }, { status: 404 });
    }

    return NextResponse.json({
      lat: data.location.latitude,
      lng: data.location.longitude,
      label: data.formattedAddress ?? data.displayName?.text ?? '',
    });
  } catch (err) {
    console.error('[place-details] fetch failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
