import assert from "node:assert";
import { buildCacheKey, roundToTimeBucket } from "../geo/cacheKey";

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

// --- Determinism: same inputs always produce the same key ---
const paramsA = {
  originHash: "wdw56h5",
  destinationHash: "wcb4g81",
  transportMode: "drive",
  requestTime: new Date("2026-07-08T07:03:00Z"),
  weatherCondition: "clear",
};
const keyA1 = buildCacheKey(paramsA);
const keyA2 = buildCacheKey(paramsA);
check("buildCacheKey: identical inputs produce identical key", keyA1, keyA2);

// --- Time bucketing: requests within the same 10-min window collapse to the same key ---
const keyEarlyInBucket = buildCacheKey({ ...paramsA, requestTime: new Date("2026-07-08T07:00:05Z") });
const keyLateInBucket = buildCacheKey({ ...paramsA, requestTime: new Date("2026-07-08T07:09:55Z") });
check("buildCacheKey: 7:00:05 and 7:09:55 fall in same 10-min bucket", keyEarlyInBucket, keyLateInBucket);

// --- Time bucketing: requests in different windows produce different keys ---
const keyNextBucket = buildCacheKey({ ...paramsA, requestTime: new Date("2026-07-08T07:10:00Z") });
check("buildCacheKey: 7:10:00 falls in a different bucket than 7:09:55", keyNextBucket !== keyLateInBucket, true);

// --- Different transport mode must produce a different key (no false cache hits across modes) ---
const keyDifferentMode = buildCacheKey({ ...paramsA, transportMode: "motorcycle_taxi" });
check("buildCacheKey: different transport mode changes the key", keyDifferentMode !== keyA1, true);

// --- Different weather must produce a different key ---
const keyDifferentWeather = buildCacheKey({ ...paramsA, weatherCondition: "storm" });
check("buildCacheKey: different weather changes the key", keyDifferentWeather !== keyA1, true);

// --- roundToTimeBucket: sanity check on the boundary itself ---
check(
  "roundToTimeBucket: 07:09:59 rounds down to 07:00:00",
  roundToTimeBucket(new Date("2026-07-08T07:09:59Z")).toISOString(),
  "2026-07-08T07:00:00.000Z"
);
check(
  "roundToTimeBucket: 07:10:00 rounds to 07:10:00 (new bucket)",
  roundToTimeBucket(new Date("2026-07-08T07:10:00Z")).toISOString(),
  "2026-07-08T07:10:00.000Z"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
