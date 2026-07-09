import assert from "node:assert";
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

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`PASS: ${label}`);
    passed++;
  } catch {
    console.error(`FAIL: ${label} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

const r1 = calculateDepartureTime({
  originHash: "u1x2y3z",
  destinationHash: "u1x2y3w",
  cityCode: "PH-MNL",
  transportMode: "drive",
  arrivalTarget: "2026-07-08T09:00:00+08:00",
  calculationTime: "2026-07-08T04:30:00+08:00",
  weatherCondition: "clear",
  rawGoogleEtaSeconds: 1800,
  dataFreshness: "live",
  recommendationVersion: v1Config,
  cityProfile: manila,
});
check("Scenario 1: rushHourDetected", r1.recommendationExplanation.rushHourDetected, false);
check("Scenario 1: confidenceScore", r1.confidenceScore, 90);
check("Scenario 1: totalBufferMinutes", r1.recommendationExplanation.totalBufferMinutes, 9.6);
check("Scenario 1: factors empty (no weather/rush contribution)", r1.recommendationExplanation.factors, []);

const r2 = calculateDepartureTime({
  originHash: "abc1111",
  destinationHash: "abc2222",
  cityCode: "PH-BAG",
  transportMode: "motorcycle_taxi",
  arrivalTarget: "2026-07-08T09:00:00+08:00",
  calculationTime: "2026-07-08T07:15:00+08:00",
  weatherCondition: "heavy_rain",
  rawGoogleEtaSeconds: 2700,
  dataFreshness: "live",
  recommendationVersion: v1Config,
  cityProfile: baguio,
});
check("Scenario 2: rushHourDetected (timezone regression guard)", r2.recommendationExplanation.rushHourDetected, true);
check("Scenario 2: confidenceScore", r2.confidenceScore, 85);
check("Scenario 2: totalBufferMinutes", r2.recommendationExplanation.totalBufferMinutes, 13.9);
check("Scenario 2: weather factor minutesAdded (hand-calc: 6*2.1-6=6.6→7)", r2.recommendationExplanation.factors[0]?.minutesAdded, 7);
check("Scenario 2: weather factor type", r2.recommendationExplanation.factors[0]?.type, "weather");
check("Scenario 2: rush factor minutesAdded (hand-calc: 6*1.1-6=0.6→1)", r2.recommendationExplanation.factors[1]?.minutesAdded, 1);
check("Scenario 2: rush factor type", r2.recommendationExplanation.factors[1]?.type, "rush_hour");

const r3 = calculateDepartureTime({
  originHash: "def3333",
  destinationHash: "def4444",
  cityCode: "PH-MNL",
  transportMode: "public_commute",
  arrivalTarget: "2026-07-08T09:00:00+08:00",
  calculationTime: "2026-07-08T07:45:00+08:00",
  weatherCondition: "storm",
  rawGoogleEtaSeconds: 3600,
  dataFreshness: "cached",
  recommendationVersion: v1Config,
  cityProfile: manila,
});
check("Scenario 3: rushHourDetected", r3.recommendationExplanation.rushHourDetected, true);
check("Scenario 3: confidenceScore", r3.confidenceScore, 70);
check("Scenario 3: totalBufferMinutes", r3.recommendationExplanation.totalBufferMinutes, 40.3);
check("Scenario 3: weather factor minutesAdded (hand-calc: 15*1.92-15=13.8→14)", r3.recommendationExplanation.factors[0]?.minutesAdded, 14);
check("Scenario 3: rush factor minutesAdded (hand-calc: 15*1.4-15=6)", r3.recommendationExplanation.factors[1]?.minutesAdded, 6);

const tightCapConfig: RecommendationVersionConfig = {
  ...v1Config,
  max_buffer_minutes: { ...v1Config.max_buffer_minutes, public_commute: 20 },
};
const r4 = calculateDepartureTime({
  originHash: "cap1111",
  destinationHash: "cap2222",
  cityCode: "PH-MNL",
  transportMode: "public_commute",
  arrivalTarget: "2026-07-08T09:00:00+08:00",
  calculationTime: "2026-07-08T07:45:00+08:00",
  weatherCondition: "storm",
  rawGoogleEtaSeconds: 3600,
  dataFreshness: "live",
  recommendationVersion: tightCapConfig,
  cityProfile: manila,
});
check("Scenario 4: buffer was capped", r4.recommendationExplanation.totalBufferMinutes, 20);
check("Scenario 4: buffer_cap factor present", r4.recommendationExplanation.factors.some(f => f.type === "buffer_cap"), true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
