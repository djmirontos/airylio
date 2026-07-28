import { supabase } from '../lib/supabase';
import { TripResult, Trip } from '../types/supabase';
import { sanitizeError } from '../utils/errors';

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

// Call the calculate-trip edge function to get route recommendations
export async function calculateTrip(params: CalculateTripParams): Promise<TripResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    const { error: authError } = await supabase.auth.signInAnonymously();
    if (authError) throw authError;
  }

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

  const { data, error } = await supabase
    .from('trips')
    .select('id, transport_mode, recommended_leave_time, predicted_arrival_time, confidence_score, confidence_reason, recommendation_explanation, planning_mode, target_time, data_freshness, weather_condition, origin_label, destination_label, origin_lat, origin_lng, destination_lat, destination_lng, created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
}

// Submit feedback for a trip
export async function submitFeedback(tripId: string, rating: 'accurate' | 'close' | 'late'): Promise<void> {
  await supabase.from('feedback').insert({
    trip_id: tripId,
    rating,
    user_success: rating !== 'late',
  });
}
