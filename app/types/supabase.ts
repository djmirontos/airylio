/**
 * A `trips` row as returned by `fetchTripHistory`.
 *
 * The fields here mirror that query's select list, so the two must be kept in
 * step. It previously declared `user_id`, `distance_meters` and `updated_at` -
 * none of which the query returns, and the first of which is not a column on
 * the table at all (it is `device_id`) - while omitting four fields the history
 * screen reads. Nullable columns are typed as such; the call sites already
 * default them.
 */
export interface Trip {
  id: string;
  transport_mode: string;
  planning_mode: string;
  target_time: string;
  recommended_leave_time: string;
  predicted_arrival_time: string;
  confidence_score: number;
  confidence_reason: string[] | null;
  recommendation_explanation: RecommendationExplanation | null;
  data_freshness: string | null;
  weather_condition?: 'clear' | 'rain' | 'heavy_rain' | 'storm';
  origin_label: string | null;
  destination_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  encoded_polyline?: string | null;
  created_at: string;
}

// Feedback record from Supabase
export interface Feedback {
  id: string;
  trip_id: string;
  user_id: string;
  accuracy: 'accurate' | 'close' | 'late';
  minutes_off: number | null;
  notes: string | null;
  created_at: string;
}

// Device record for storing device identifiers
export interface Device {
  id: string;
  user_id: string;
  device_id: string;
  platform: 'ios' | 'android';
  push_token: string | null;
  last_seen: string;
  created_at: string;
}

// Trip result with all calculated data
export interface TripResult {
  tripId: string;
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  dataFreshness: string;
  distanceMeters?: number;
  weatherCondition?: 'clear' | 'rain' | 'heavy_rain' | 'storm';
  encodedPolyline?: string;
  recommendationExplanation?: RecommendationExplanation;
  railRoute?: {
    legs: RailLeg[];
    via: string;
    routeType: string;
    queuePenaltySeconds: number;
    totalSeconds: number;
    boardingStation?: { name: string; lat: number; lng: number };
    alightingStation?: { name: string; lat: number; lng: number };
  } | null;
  commuteBreakdown?: CommuteBreakdown | null;
  // Carried on the result so the map button can deep-link a transit route.
  // The Edge Function does not return these; they are attached client-side.
  originLat?: number;
  originLng?: number;
  destLat?: number;
  destLng?: number;
}

export interface RecommendationExplanation {
  planningMode?: 'arrive_by' | 'leave_at';
  factors: ExplanationFactor[];
}

export interface ExplanationFactor {
  type: 'weather' | 'rush_hour' | 'buffer_cap';
  label: string;
  minutesAdded: number;
}

export interface RailLeg {
  type: 'walk' | 'wait' | 'ride' | 'transfer';
  label: string;
  seconds: number;
  line?: string;
}

export interface CommuteBreakdown {
  legs: RailLeg[];
  via: string;
  queuePenaltySeconds: number;
  totalMinutes: number;
}
