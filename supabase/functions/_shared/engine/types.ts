export type WeatherCondition = 'clear' | 'rain' | 'heavy_rain' | 'storm';
export type DataFreshness = 'live' | 'cached' | 'estimated';

export interface RecommendationVersionConfig {
  base_buffer_minutes: Record<string, number>;
  max_buffer_minutes: Record<string, number>;
  weather_multiplier: Record<WeatherCondition, number>;
  rush_hour_multiplier: Record<string, number>;
  confidence_baseline: Record<string, number>;
}

export interface CityProfileConfig {
  cityCode: string;
  timezone: string; // IANA name, e.g. "Asia/Manila" — required for correct rush-hour detection
  rushHourConfig: {
    morning: string;
    evening: string;
  };
  weatherSensitivity: number;
}

export type PlanningMode = 'arrive_by' | 'leave_at';

export interface CalculateDepartureInput {
  originHash: string;
  destinationHash: string;
  cityCode: string;
  transportMode: string;
  planningMode: PlanningMode;
  targetTime: string; // arrival_target if planningMode='arrive_by', departure time if 'leave_at'
  calculationTime: string;
  weatherCondition: WeatherCondition;
  rawGoogleEtaSeconds: number;
  dataFreshness: DataFreshness;
  recommendationVersion: RecommendationVersionConfig;
  cityProfile: CityProfileConfig;
}

// New: per-factor breakdown of the buffer, for richer "why this recommendation"
// UI (e.g. "Rain added ~8 min"). These are illustrative approximations, not
// an exact ledger — see calculateDeparture.ts for why they don't sum exactly
// to totalBufferMinutes (the real formula is multiplicative, this isolates
// each factor's marginal contribution against the base buffer).
export type ExplanationFactorType = 'weather' | 'rush_hour' | 'buffer_cap';

export interface ExplanationFactor {
  type: ExplanationFactorType;
  label: string;
  minutesAdded: number;
}

export interface CalculateDepartureResult {
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  recommendationExplanation: {
    city: string;
    planningMode: PlanningMode;
    weatherMultiplierApplied: number;
    baseBufferMinutes: number;
    totalBufferMinutes: number;
    rushHourDetected: boolean;
    reason: string[];
    factors: ExplanationFactor[];
  };
}

export interface RailLeg {
  type: 'walk' | 'wait' | 'ride' | 'transfer';
  label: string;
  seconds: number;
  line?: string;
}

export interface RailRoute {
  legs: RailLeg[];
  totalSeconds: number;
  queuePenaltySeconds: number;
  via: string;
  routeType: 'rail' | 'hybrid';
}
