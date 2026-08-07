export type TransportMode = 'drive' | 'public_commute' | 'motorcycle_taxi' | 'walk';
export type PlanningMode = 'arrive_by' | 'leave_at';

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

export interface TripResult {
  tripId: string;
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  dataFreshness: string;
  distanceMeters?: number;
  weatherCondition?: string;
  encodedPolyline?: string;
  commuteBreakdown?: CommuteBreakdown | null;
  railRoute?: any;
  recommendationExplanation?: {
    planningMode?: string;
    factors: Array<{
      type: string;
      label: string;
      minutesAdded: number;
    }>;
  };
}
