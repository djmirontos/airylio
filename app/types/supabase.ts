// Trip record from Supabase
export interface Trip {
  id: string;
  user_id: string;
  transport_mode: 'drive' | 'motorcycle_taxi' | 'public_commute' | 'walk';
  planning_mode: 'arrive_by' | 'leave_at';
  origin_label: string;
  destination_label: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  recommended_leave_time: string;
  predicted_arrival_time: string;
  confidence_score: number;
  distance_meters: number;
  created_at: string;
  updated_at: string;
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
  recommendationExplanation?: {
    planningMode?: 'arrive_by' | 'leave_at';
    factors: ExplanationFactor[];
  };
}

export interface ExplanationFactor {
  type: 'weather' | 'rush_hour' | 'buffer_cap';
  label: string;
  minutesAdded: number;
}
