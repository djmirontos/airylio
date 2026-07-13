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
