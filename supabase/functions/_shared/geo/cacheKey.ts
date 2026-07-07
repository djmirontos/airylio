// =============================================================================
// Cache key builder for route_cache.
//
// Pure function: given the request's identifying attributes, deterministically
// builds the same cache_key string used for both writing to route_cache and
// looking it up. Using one shared function for both paths guarantees they
// can never independently drift and silently miss each other.
//
// Time is rounded down to a 10-minute bucket — this is what actually makes
// caching effective. Without rounding, every request would get a unique
// timestamp and never hit an existing cache entry.
// =============================================================================

const TIME_BUCKET_MINUTES = 10;

export function roundToTimeBucket(date: Date): Date {
  const ms = date.getTime();
  const bucketMs = TIME_BUCKET_MINUTES * 60 * 1000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs);
}

export function buildCacheKey(params: {
  originHash: string;
  destinationHash: string;
  transportMode: string;
  requestTime: Date;
  weatherCondition: string;
}): string {
  const bucket = roundToTimeBucket(params.requestTime);
  const bucketIso = bucket.toISOString().slice(0, 16).replace(/[-:]/g, ""); // e.g. 20260708T0700

  return [
    params.originHash,
    params.destinationHash,
    params.transportMode,
    bucketIso,
    params.weatherCondition,
  ].join("-");
}
