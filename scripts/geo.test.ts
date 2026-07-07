import assert from "node:assert";
import { encodeGeohash } from "../geo/geohash";
import { detectCity } from "../geo/detectCity";
import type { CityBoundary } from "../geo/types";

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

// --- Geohash: verified against a reference implementation before this test was written ---
check(
  "geohash: Manila landmark (14.6560, 121.0300)",
  encodeGeohash(14.6560, 121.0300, 7),
  "wdw56h5"
);
check(
  "geohash: Cebu landmark (10.3280, 123.9060)",
  encodeGeohash(10.3280, 123.9060, 7),
  "wcb4g81"
);
check(
  "geohash: nearby point (+0.0005 lat) stays in same ~150m cell",
  encodeGeohash(14.6565, 121.0300, 7),
  "wdw56h5"
);

// --- City detection ---
const cities: CityBoundary[] = [
  { cityCode: "PH-MNL", launchPriority: 1, boundary: { minLat: 14.35, maxLat: 14.78, minLng: 120.90, maxLng: 121.15 } },
  { cityCode: "PH-CEB", launchPriority: 2, boundary: { minLat: 10.25, maxLat: 10.45, minLng: 123.80, maxLng: 123.95 } },
];

check("detectCity: point inside Manila box", detectCity(14.6560, 121.0300, cities), "PH-MNL");
check("detectCity: point inside Cebu box", detectCity(10.3280, 123.9060, cities), "PH-CEB");
check("detectCity: point outside all boxes returns null", detectCity(0, 0, cities), null);

// --- Overlap tie-break: two overlapping boxes, lowest launchPriority wins ---
const overlapping: CityBoundary[] = [
  { cityCode: "PH-MNL", launchPriority: 1, boundary: { minLat: 14.0, maxLat: 15.0, minLng: 120.5, maxLng: 121.5 } },
  { cityCode: "PH-FAKE-OVERLAP", launchPriority: 5, boundary: { minLat: 14.0, maxLat: 15.0, minLng: 120.5, maxLng: 121.5 } },
];
check(
  "detectCity: overlap resolved by lowest launchPriority",
  detectCity(14.5, 121.0, overlapping),
  "PH-MNL"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
