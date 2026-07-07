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

export interface CalculateDepartureInput {
  originHash: string;
  destinationHash: string;
  cityCode: string;
  transportMode: string;
  arrivalTarget: string;
  calculationTime: string;
  weatherCondition: WeatherCondition;
  rawGoogleEtaSeconds: number;
  dataFreshness: DataFreshness;
  recommendationVersion: RecommendationVersionConfig;
  cityProfile: CityProfileConfig;
}

export interface CalculateDepartureResult {
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  recommendationExplanation: {
    city: string;
    weatherMultiplierApplied: number;
    baseBufferMinutes: number;
    totalBufferMinutes: number;
    rushHourDetected: boolean;
    reason: string[];
  };
}
