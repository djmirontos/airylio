import { calculateDepartureTime } from "../engine/calculateDeparture";
import type { RecommendationVersionConfig, CityProfileConfig } from "../engine/types";

const v1Config: RecommendationVersionConfig = {
  base_buffer_minutes: { drive: 8, motorcycle_taxi: 6, public_commute: 15, bicycle: 5, walk: 3 },
  max_buffer_minutes: { drive: 30, motorcycle_taxi: 25, public_commute: 45, bicycle: 20, walk: 10 },
  weather_multiplier: { clear: 1.0, rain: 1.2, heavy_rain: 1.4, storm: 1.6 },
  rush_hour_multiplier: { drive: 1.3, motorcycle_taxi: 1.1, public_commute: 1.4, bicycle: 1.0, walk: 1.0 },
  confidence_baseline: { drive: 90, motorcycle_taxi: 85, public_commute: 75, bicycle: 90, walk: 95 },
};

const manila: CityProfileConfig = {
  cityCode: "PH-MNL",
  timezone: "Asia/Manila",
  rushHourConfig: { morning: "06:00-09:00", evening: "17:00-20:00" },
  weatherSensitivity: 1.2,
};

const baguio: CityProfileConfig = {
  cityCode: "PH-BAG",
  timezone: "Asia/Manila",
  rushHourConfig: { morning: "06:30-08:30", evening: "16:30-19:00" },
  weatherSensitivity: 1.5,
};

console.log("=== Scenario 1: Manila, Drive, clear weather, off-peak calculation ===");
const r1 = calculateDepartureTime({
  originHash: "u1x2y3z",
  destinationHash: "u1x2y3w",
  cityCode: "PH-MNL",
  transportMode: "drive",
  arrivalTarget: "2026-07-08T09:00:00+08:00",
  calculationTime: "2026-07-08T04:30:00+08:00", // 4:30 AM — off-peak
  weatherCondition: "clear",
  rawGoogleEtaSeconds: 1800, // 30 min
  dataFreshness: "live",
  recommendationVersion: v1Config,
  cityProfile: manila,
});
console.log(JSON.stringify(r1, null, 2));

console.log("\n=== Scenario 2: Baguio, Motorcycle Taxi, heavy rain, morning rush hour ===");
const r2 = calculateDepartureTime({
  originHash: "abc1111",
  destinationHash: "abc2222",
  cityCode: "PH-BAG",
  transportMode: "motorcycle_taxi",
  arrivalTarget: "2026-07-08T09:00:00+08:00",
  calculationTime: "2026-07-08T07:15:00+08:00", // 7:15 AM — inside morning rush window
  weatherCondition: "heavy_rain",
  rawGoogleEtaSeconds: 2700, // 45 min
  dataFreshness: "live",
  recommendationVersion: v1Config,
  cityProfile: baguio,
});
console.log(JSON.stringify(r2, null, 2));

console.log("\n=== Scenario 3: Manila, Public Commute, storm, cached data (tests buffer cap) ===");
const r3 = calculateDepartureTime({
  originHash: "def3333",
  destinationHash: "def4444",
  cityCode: "PH-MNL",
  transportMode: "public_commute",
  arrivalTarget: "2026-07-08T09:00:00+08:00",
  calculationTime: "2026-07-08T07:45:00+08:00", // inside morning rush window
  weatherCondition: "storm",
  rawGoogleEtaSeconds: 3600, // 60 min
  dataFreshness: "cached",
  recommendationVersion: v1Config,
  cityProfile: manila,
});
console.log(JSON.stringify(r3, null, 2));

