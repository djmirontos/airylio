import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

export async function GET() {
  const supabase = getAdminClient();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const last7Days = new Date(now);
  last7Days.setDate(last7Days.getDate() - 7);
  const last30Days = new Date(now);
  last30Days.setDate(last30Days.getDate() - 30);

  const [
    totalDevices,
    totalCalculations,
    todayCalculations,
    yesterdayCalculations,
    todayNewDevices,
    last7DaysCalculations,
    transportModes,
    planningModes,
    dataFreshness,
    weatherConditions,
    errors,
    railRoutes,
    hourlyCalculations,
    dailyCalculations,
    topCorridors,
    avgConfidence,
  ] = await Promise.all([
    // 1. Total unique devices
    supabase.from('devices').select('id', { count: 'exact', head: true }),

    // 2. Total calculations
    supabase.from('trips').select('id', { count: 'exact', head: true }),

    // 3. Today calculations
    supabase.from('trips')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString()),

    // 4. Yesterday calculations
    supabase.from('trips')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterdayStart.toISOString())
      .lt('created_at', todayStart.toISOString()),

    // 5. New devices today
    supabase.from('devices')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString()),

    // 6. Last 7 days calculations
    supabase.from('trips')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', last7Days.toISOString()),

    // 7. Transport mode breakdown
    supabase.from('trips')
      .select('transport_mode')
      .gte('created_at', last30Days.toISOString()),

    // 8. Planning mode breakdown
    supabase.from('trips')
      .select('planning_mode')
      .gte('created_at', last30Days.toISOString()),

    // 9. Data freshness (cache hit rate)
    supabase.from('trips')
      .select('data_freshness')
      .gte('created_at', last30Days.toISOString()),

    // 10. Weather conditions
    supabase.from('trips')
      .select('weather_condition')
      .gte('created_at', last30Days.toISOString()),

    // 11. Error events in last 24h
    supabase.from('calculation_events')
      .select('event_type', { count: 'exact', head: true })
      .in('event_type', ['google_api_error', 'no_route_found', 'fallback_used'])
      .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()),

    // 12. Rail routes.
    // Counted from the event the Edge Function actually emits, not inferred
    // from a confidence threshold: a threshold cannot tell a rail trip from a
    // ground trip that happens to score the same, and it breaks silently if
    // confidence_baseline is ever retuned.
    supabase.from('calculation_events')
      .select('calculation_id', { count: 'exact', head: true })
      .eq('event_type', 'rail_route_detected')
      .gte('created_at', last30Days.toISOString()),

    // 13. Hourly calculation distribution (last 7 days)
    supabase.from('trips')
      .select('created_at')
      .gte('created_at', last7Days.toISOString())
      .order('created_at', { ascending: true }),

    // 14. Daily calculations (last 30 days)
    supabase.from('trips')
      .select('created_at')
      .gte('created_at', last30Days.toISOString())
      .order('created_at', { ascending: true }),

    // 15. Top corridors
    supabase.from('trips')
      .select('origin_label, destination_label, transport_mode')
      .not('origin_label', 'is', null)
      .not('destination_label', 'is', null)
      .gte('created_at', last30Days.toISOString()),

    // 16. Average confidence score
    supabase.from('trips')
      .select('confidence_score, transport_mode')
      .gte('created_at', last30Days.toISOString()),
  ]);

  // Process transport modes
  const modeCount: Record<string, number> = {};
  (transportModes.data ?? []).forEach((t: any) => {
    modeCount[t.transport_mode] = (modeCount[t.transport_mode] ?? 0) + 1;
  });

  // Process planning modes
  const planCount: Record<string, number> = {};
  (planningModes.data ?? []).forEach((t: any) => {
    planCount[t.planning_mode] = (planCount[t.planning_mode] ?? 0) + 1;
  });

  // Process data freshness
  const freshnessCount: Record<string, number> = {};
  (dataFreshness.data ?? []).forEach((t: any) => {
    freshnessCount[t.data_freshness] = (freshnessCount[t.data_freshness] ?? 0) + 1;
  });

  // Process weather
  const weatherCount: Record<string, number> = {};
  (weatherConditions.data ?? []).forEach((t: any) => {
    weatherCount[t.weather_condition] = (weatherCount[t.weather_condition] ?? 0) + 1;
  });

  // Process hourly distribution
  const hourlyCount: Record<number, number> = {};
  (hourlyCalculations.data ?? []).forEach((t: any) => {
    // Convert to Manila time (UTC+8)
    const hour = (new Date(t.created_at).getUTCHours() + 8) % 24;
    hourlyCount[hour] = (hourlyCount[hour] ?? 0) + 1;
  });
  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`,
    count: hourlyCount[h] ?? 0,
  }));

  // Process daily calculations
  const dailyCount: Record<string, number> = {};
  (dailyCalculations.data ?? []).forEach((t: any) => {
    const day = new Date(t.created_at).toISOString().split('T')[0];
    dailyCount[day] = (dailyCount[day] ?? 0) + 1;
  });
  const dailyData = Object.entries(dailyCount)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      date: date.slice(5), // MM-DD
      count,
    }));

  // Process top corridors
  const corridorCount: Record<string, number> = {};
  (topCorridors.data ?? []).forEach((t: any) => {
    const key = `${t.origin_label?.split(',')[0]} → ${t.destination_label?.split(',')[0]}`;
    corridorCount[key] = (corridorCount[key] ?? 0) + 1;
  });
  const topCorridorList = Object.entries(corridorCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([corridor, count]) => ({ corridor, count }));

  // Process avg confidence by mode
  const confidenceByMode: Record<string, number[]> = {};
  (avgConfidence.data ?? []).forEach((t: any) => {
    if (!confidenceByMode[t.transport_mode])
      confidenceByMode[t.transport_mode] = [];
    confidenceByMode[t.transport_mode].push(Number(t.confidence_score));
  });
  const avgConfidenceByMode = Object.entries(confidenceByMode).map(([mode, scores]) => ({
    mode,
    avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  }));

  // Cache hit rate
  const totalFreshness = Object.values(freshnessCount).reduce((a, b) => a + b, 0);
  const cacheHitRate = totalFreshness > 0
    ? Math.round(((freshnessCount['cached'] ?? 0) / totalFreshness) * 100)
    : 0;

  // Rail vs ground for commute. Clamped at zero: rail events and the trips
  // window are counted from different tables, so a boundary case could
  // otherwise show a negative ground count.
  const totalCommute = modeCount['public_commute'] ?? 0;
  const railCount = Math.min(railRoutes.count ?? 0, totalCommute);
  const groundCount = Math.max(totalCommute - railCount, 0);

  return NextResponse.json({
    summary: {
      totalDevices: totalDevices.count ?? 0,
      totalCalculations: totalCalculations.count ?? 0,
      todayCalculations: todayCalculations.count ?? 0,
      yesterdayCalculations: yesterdayCalculations.count ?? 0,
      todayNewDevices: todayNewDevices.count ?? 0,
      last7DaysCalculations: last7DaysCalculations.count ?? 0,
      errors24h: errors.count ?? 0,
      cacheHitRate,
      railCount,
      groundCount,
      totalCommute,
    },
    charts: {
      transportModes: Object.entries(modeCount).map(([mode, count]) => ({ mode, count })),
      planningModes: Object.entries(planCount).map(([mode, count]) => ({ mode, count })),
      dataFreshness: Object.entries(freshnessCount).map(([type, count]) => ({ type, count })),
      weatherConditions: Object.entries(weatherCount).map(([condition, count]) => ({ condition, count })),
      hourlyDistribution: hourlyData,
      dailyCalculations: dailyData,
      avgConfidenceByMode,
    },
    topCorridors: topCorridorList,
  });
}
