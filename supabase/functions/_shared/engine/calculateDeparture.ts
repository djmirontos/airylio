// =============================================================================
// Airylio Recommendation Engine — calculateDepartureTime()
//
// Design contract (approved):
//   - Pure function: no database calls, no Google API calls, no side effects.
//   - All config (recommendation version, city profile) is passed in, not
//     fetched here — this is what makes the function unit-testable with
//     fake inputs and fully reproducible given the same arguments.
//   - Output shape maps directly onto the `trips` table columns.
//
// Planning modes (added for "Leave At" mode):
//   - arrive_by: targetTime is the arrival deadline. Buffer is SUBTRACTED
//     from it to get predicted arrival, then travel time subtracted again
//     to get recommended leave time. (Original, unchanged behavior.)
//   - leave_at: targetTime is the departure time itself (may be "now" or a
//     future time the user picks). recommendedLeaveTime just echoes it
//     back; buffer is ADDED on top of travel time to get predicted arrival.
//     Rush-hour detection uses targetTime (the actual departure moment),
//     NOT calculationTime — unlike arrive_by mode, where departure is
//     usually soon after calculation so calculationTime is a reasonable
//     proxy, a leave_at departure could be hours away.
//
// V1 simplifications (documented, not hidden):
//   1. Rush-hour detection uses wall-clock hour in the CITY'S timezone
//      (via Intl.DateTimeFormat), not the server's local timezone. This
//      was a real bug caught via regression testing (server UTC+3, city
//      UTC+8 — see engine.test.ts "timezone regression guard").
//   2. Confidence penalties for cached/estimated data freshness are fixed
//      heuristics (-5 / -15), not derived from historical accuracy —
//      intentional per "heuristics, not product truths."
//   3. Per-factor breakdown (`factors`) isolates each factor's marginal
//      contribution against the base buffer (holding other factors
//      neutral). Because the real formula is multiplicative
//      (base × weather × rush), these contributions do NOT sum exactly
//      to totalBufferMinutes — there's a cross-term the isolated view
//      can't capture. This is intentionally an illustrative approximation
//      for UI purposes ("rain added ~8 min"), not an exact ledger.
// =============================================================================

import type {
  CalculateDepartureInput,
  CalculateDepartureResult,
  ExplanationFactor,
} from './types.ts';

function parseTimeWindow(window: string): { startMinutes: number; endMinutes: number } {
  const [start, end] = window.split('-');
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  return { startMinutes: toMinutes(start), endMinutes: toMinutes(end) };
}

function getLocalMinutesOfDay(date: Date, timeZone: string): number {
  // Reads the wall-clock hour/minute IN THE CITY'S TIMEZONE, regardless of
  // what timezone the Node/Deno process itself is running in.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function isWithinRushHour(momentToCheck: Date, cityProfile: CalculateDepartureInput['cityProfile']): boolean {
  const minutesOfDay = getLocalMinutesOfDay(momentToCheck, cityProfile.timezone);
  const morning = parseTimeWindow(cityProfile.rushHourConfig.morning);
  const evening = parseTimeWindow(cityProfile.rushHourConfig.evening);

  const inWindow = (w: { startMinutes: number; endMinutes: number }) =>
    minutesOfDay >= w.startMinutes && minutesOfDay <= w.endMinutes;

  return inWindow(morning) || inWindow(evening);
}

export function calculateDepartureTime(
  input: CalculateDepartureInput
): CalculateDepartureResult {
  const {
    transportMode,
    planningMode,
    targetTime,
    calculationTime,
    weatherCondition,
    rawGoogleEtaSeconds,
    dataFreshness,
    recommendationVersion,
    cityProfile,
    cityCode,
  } = input;

  const config = recommendationVersion;
  const calcTimeDate = new Date(calculationTime);
  const targetTimeDate = new Date(targetTime);

  // --- Rush hour detection ---
  // arrive_by: departure is usually soon, so calculationTime is a reasonable
  // proxy for when travel actually happens.
  // leave_at: targetTime IS the departure moment - use it directly, since
  // it could be hours away from calculationTime.
  const rushHourCheckMoment = planningMode === 'leave_at' ? targetTimeDate : calcTimeDate;
  const rushHourDetected = isWithinRushHour(rushHourCheckMoment, cityProfile);
  const rushHourMultiplier = rushHourDetected
    ? (config.rush_hour_multiplier[transportMode] ?? 1.0)
    : 1.0;

  // --- Weather adjustment: base multiplier compounded with city sensitivity ---
  const baseWeatherMultiplier = config.weather_multiplier[weatherCondition] ?? 1.0;
  const weatherMultiplierApplied = baseWeatherMultiplier * cityProfile.weatherSensitivity;

  // --- Buffer calculation, guarded by the per-mode maximum ---
  const baseBufferMinutes = config.base_buffer_minutes[transportMode] ?? 5;
  const maxBufferMinutes = config.max_buffer_minutes[transportMode] ?? baseBufferMinutes * 3;

  const uncappedBufferMinutes =
    baseBufferMinutes * weatherMultiplierApplied * rushHourMultiplier;
  const totalBufferMinutes = Math.min(uncappedBufferMinutes, maxBufferMinutes);
  const bufferWasCapped = uncappedBufferMinutes > maxBufferMinutes;
  const totalBufferSeconds = Math.round(totalBufferMinutes * 60);

  // --- Departure / arrival times: direction depends on planning mode ---
  let predictedArrivalDate: Date;
  let recommendedLeaveDate: Date;

  if (planningMode === 'leave_at') {
    // Departure is fixed (given). Buffer is ADDED on top of travel time,
    // since it represents how much LATER you might actually arrive.
    recommendedLeaveDate = targetTimeDate;
    predictedArrivalDate = new Date(
      targetTimeDate.getTime() + rawGoogleEtaSeconds * 1000 + totalBufferSeconds * 1000
    );
  } else {
    // arrive_by (original behavior): buffer is SUBTRACTED from the arrival
    // deadline, then travel time subtracted again to get leave time.
    predictedArrivalDate = new Date(
      targetTimeDate.getTime() - totalBufferSeconds * 1000
    );
    recommendedLeaveDate = new Date(
      predictedArrivalDate.getTime() - rawGoogleEtaSeconds * 1000
    );
  }

  // --- Confidence score ---
  let confidenceScore = config.confidence_baseline[transportMode] ?? 80;
  const confidenceReason: string[] = [];

  if (dataFreshness === 'live') {
    confidenceReason.push('Live traffic data available');
  } else if (dataFreshness === 'cached') {
    confidenceScore -= 5;
    confidenceReason.push('Using recently cached traffic data');
  } else {
    confidenceScore -= 15;
    confidenceReason.push('Live traffic unavailable — using historical estimate');
  }

  if (weatherCondition !== 'clear') {
    confidenceReason.push(`Weather (${weatherCondition}) increases uncertainty`);
  }
  if (rushHourDetected) {
    confidenceReason.push('Rush hour traffic expected');
  }
  if (bufferWasCapped) {
    confidenceReason.push('Extreme conditions detected — buffer capped at maximum for this mode');
  }

  confidenceScore = Math.max(0, Math.min(100, Math.round(confidenceScore * 10) / 10));

  // --- Explanation (frozen into trips.recommendation_explanation) ---
  const explanationReason: string[] = [];
  if (weatherCondition !== 'clear') {
    explanationReason.push(`${weatherCondition} increases travel uncertainty`);
  }
  if (rushHourDetected) {
    explanationReason.push('Rush hour congestion detected');
  }
  explanationReason.push(`${Math.round(totalBufferMinutes)}-minute safety buffer added`);

  // --- Per-factor breakdown (approximation, see file header) ---
  const factors: ExplanationFactor[] = [];

  if (weatherCondition !== 'clear') {
    const weatherOnlyBuffer = baseBufferMinutes * weatherMultiplierApplied;
    const weatherMinutesAdded = Math.round(weatherOnlyBuffer - baseBufferMinutes);
    if (weatherMinutesAdded !== 0) {
      factors.push({
        type: 'weather',
        label: `${weatherCondition.charAt(0).toUpperCase()}${weatherCondition.slice(1).replace('_', ' ')} may add ${weatherMinutesAdded} min`,
        minutesAdded: weatherMinutesAdded,
      });
    }
  }

  if (rushHourDetected) {
    const rushOnlyBuffer = baseBufferMinutes * rushHourMultiplier;
    const rushMinutesAdded = Math.round(rushOnlyBuffer - baseBufferMinutes);
    if (rushMinutesAdded !== 0) {
      factors.push({
        type: 'rush_hour',
        label: `Rush hour may add ${rushMinutesAdded} min`,
        minutesAdded: rushMinutesAdded,
      });
    }
  }

  if (bufferWasCapped) {
    const cappedReduction = Math.round(totalBufferMinutes - uncappedBufferMinutes);
    factors.push({
      type: 'buffer_cap',
      label: `Buffer capped for extreme conditions (${cappedReduction} min)`,
      minutesAdded: cappedReduction,
    });
  }

  return {
    recommendedLeaveTime: recommendedLeaveDate.toISOString(),
    predictedArrivalTime: predictedArrivalDate.toISOString(),
    confidenceScore,
    confidenceReason,
    recommendationExplanation: {
      city: cityCode,
      planningMode,
      weatherMultiplierApplied: Math.round(weatherMultiplierApplied * 100) / 100,
      baseBufferMinutes,
      totalBufferMinutes: Math.round(totalBufferMinutes * 10) / 10,
      rushHourDetected,
      reason: explanationReason,
      factors,
    },
  };
}
