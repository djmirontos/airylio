import { supabase } from '../lib/supabase';
import { TripResult, Trip } from '../types/supabase';
import { sanitizeError } from '../utils/errors';
import { setSentryUser } from '../lib/sentry';
import { identifyUser } from '../lib/posthog';

export interface CalculateTripParams {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  planningMode: 'arrive_by' | 'leave_at';
  targetTime: string;
  transportMode: string;
  originLabel: string;
  destinationLabel: string;
}

// In-flight anonymous sign-in, shared by concurrent callers.
//
// Without this, two calculations started close together both observe "no
// session" and each call signInAnonymously, producing two anonymous users. The
// second session wins, so the first trip ends up owned by an identity the
// device no longer holds - and disappears from history.
let signInPromise: Promise<void> | null = null;

async function ensureSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    // Tags crash reports with the anonymous device identity, so a Sentry issue
    // can be traced back to that device's trips.
    setSentryUser(data.session.user.id);
    identifyUser(data.session.user.id);
    return;
  }

  if (!signInPromise) {
    signInPromise = supabase.auth
      .signInAnonymously()
      .then(({ data: signInData, error }) => {
        if (error) throw error;
        if (signInData.session) {
          setSentryUser(signInData.session.user.id);
          identifyUser(signInData.session.user.id);
        }
      })
      .finally(() => {
        signInPromise = null;
      });
  }
  return signInPromise;
}

// Call the calculate-trip edge function to get route recommendations
export async function calculateTrip(params: CalculateTripParams): Promise<TripResult> {
  await ensureSession();

  const { data, error: fnError } = await supabase.functions.invoke('calculate-trip', {
    body: {
      originLat: params.originLat,
      originLng: params.originLng,
      destLat: params.destLat,
      destLng: params.destLng,
      planningMode: params.planningMode,
      targetTime: params.targetTime,
      transportMode: params.transportMode,
      originLabel: params.originLabel,
      destinationLabel: params.destinationLabel,
    },
  });

  if (fnError) {
    const bodyText = await fnError.context?.text?.();
    const message = bodyText || fnError.message;
    throw new Error(sanitizeError(message));
  }

  return data;
}

// Fetch user's trip history from database.
// Scoping is enforced by RLS on `trips`; the explicit device_id filter here is
// defence in depth, so a policy regression cannot silently expose other users'
// trips (which carry home/work coordinates).
export async function fetchTripHistory(): Promise<Trip[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const deviceId = sessionData.session?.user?.id;
  if (!deviceId) return [];

  // Also tag here: a user who only opens History never calls ensureSession(),
  // so their crashes would otherwise be unattributed.
  setSentryUser(deviceId);
  identifyUser(deviceId);

  const { data, error } = await supabase
    .from('trips')
    .select('id, transport_mode, recommended_leave_time, predicted_arrival_time, confidence_score, confidence_reason, recommendation_explanation, planning_mode, target_time, data_freshness, weather_condition, origin_label, destination_label, origin_lat, origin_lng, destination_lat, destination_lng, created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
}

// Submit feedback for a trip.
// The insert result was previously discarded, so a rejected write (RLS,
// offline, bad trip id) still showed the user a success state.
export async function submitFeedback(tripId: string, rating: 'accurate' | 'close' | 'late'): Promise<void> {
  const { error } = await supabase.from('feedback').insert({
    trip_id: tripId,
    rating,
    user_success: rating !== 'late',
  });

  if (error) {
    console.warn('[tripService] Feedback submission failed:', error.message);
    throw new Error(sanitizeError(error.message));
  }
}
