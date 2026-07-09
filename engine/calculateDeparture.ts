import type {
  CalculateDepartureInput,
  CalculateDepartureResult,
  ExplanationFactor,
} from './types';

function parseTimeWindow(window: string): { startMinutes: number; endMinutes: number } {
  const [start, end] = window.split('-');
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  return { startMinutes: toMinutes(start), endMinutes: toMinutes(end) };
}

function getLocalMinutesOfDay(date: Date, timeZone: string): number {
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

function isWithinRushHour(calculationTime: Date, cityProfile: CalculateDepartureInput['cityProfile']): boolean {
  const minutesOfDay = getLocalMinutesOfDay(calculationTime, cityProfile.timezone);
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
    arrivalTarget,
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
  const arrivalTargetDate = new Date(arrivalTarget);

  const rushHourDetected = isWithinRushHour(calcTimeDate, cityProfile);
  const rushHourMultiplier = rushHourDetected
    ? (config.rush_hour_multiplier[transportMode] ?? 1.0)
    : 1.0;

  const baseWeatherMultiplier = config.weather_multiplier[weatherCondition] ?? 1.0;
  const weatherMultiplierApplied = baseWeatherMultiplier * cityProfile.weatherSensitivity;

  const baseBufferMinutes = config.base_buffer_minutes[transportMode] ?? 5;
  const maxBufferMinutes = config.max_buffer_minutes[transportMode] ?? baseBufferMinutes * 3;

  const uncappedBufferMinutes =
    baseBufferMinutes * weatherMultiplierApplied * rushHourMultiplier;
  const totalBufferMinutes = Math.min(uncappedBufferMinutes, maxBufferMinutes);
  const bufferWasCapped = uncappedBufferMinutes > maxBufferMinutes;

  const totalBufferSeconds = Math.round(totalBufferMinutes * 60);
  const predictedArrivalDate = new Date(
    arrivalTargetDate.getTime() - totalBufferSeconds * 1000
  );
  const recommendedLeaveDate = new Date(
    predictedArrivalDate.getTime() - rawGoogleEtaSeconds * 1000
  );

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

  const explanationReason: string[] = [];
  if (weatherCondition !== 'clear') {
    explanationReason.push(`${weatherCondition} increases travel uncertainty`);
  }
  if (rushHourDetected) {
    explanationReason.push('Rush hour congestion detected');
  }
  explanationReason.push(`${Math.round(totalBufferMinutes)}-minute safety buffer added`);

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
      weatherMultiplierApplied: Math.round(weatherMultiplierApplied * 100) / 100,
      baseBufferMinutes,
      totalBufferMinutes: Math.round(totalBufferMinutes * 10) / 10,
      rushHourDetected,
      reason: explanationReason,
      factors,
    },
  };
}
