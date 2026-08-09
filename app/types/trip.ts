export type PlanningMode = 'arrive_by' | 'leave_at';

export interface ExplanationFactor {
  type: 'weather' | 'rush_hour' | 'buffer_cap';
  label: string;
  minutesAdded: number;
}

export interface TripResult {
  tripId: string;
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  dataFreshness: string;
  distanceMeters?: number;
  weatherCondition?: 'clear' | 'rain' | 'heavy_rain' | 'storm';
  recommendationExplanation?: {
    planningMode?: PlanningMode;
    factors: ExplanationFactor[];
  };
}

export interface CommuteProfile {
  id: string;
  device_id?: string;
  label: string;
  origin_label: string;
  origin_lat: number;
  origin_lng: number;
  destination_label: string;
  destination_lat: number;
  destination_lng: number;
  target_arrival_time: string;
  transport_mode: 'drive' | 'motorcycle_taxi' | 'public_commute' | 'walk';
  morning_brief_enabled: boolean;
  baseline_leave_time: string | null;
  created_at?: string;
}
