'use client';
import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

const COLORS = ['#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899'];

const MODE_LABELS: Record<string, string> = {
  drive: 'Drive',
  public_commute: 'Commute',
  motorcycle_taxi: 'Motorcycle',
  walk: 'Walk',
  arrive_by: 'Arrive By',
  leave_at: 'Leave At',
  live: 'Live',
  cached: 'Cached',
  estimated: 'Estimated',
  clear: 'Clear',
  rain: 'Rain',
  heavy_rain: 'Heavy Rain',
  storm: 'Storm',
};

function StatCard({ label, value, sub, color }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
      <p className="text-gray-400 text-sm font-medium">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-white mb-4 mt-8">{children}</h2>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function fetchData() {
    try {
      const res = await fetch('/api/metrics');
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to fetch metrics', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-purple-400 text-lg font-medium animate-pulse">
          Loading dashboard...
        </div>
      </div>
    );
  }

  // A failed fetch leaves data null; without this the destructure below throws
  // and the page renders blank with only a console error.
  if (!data?.summary) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">Could not load metrics.</p>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  const { summary, charts, topCorridors } = data;

  const calcDelta = summary.todayCalculations - summary.yesterdayCalculations;
  const calcDeltaText = calcDelta >= 0
    ? `+${calcDelta} vs yesterday`
    : `${calcDelta} vs yesterday`;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Airylio Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : 'Loading...'}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2
                       rounded-xl text-sm font-medium transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Section 1 — Daily Health */}
        <SectionTitle>📊 Daily Health</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Calculations Today"
            value={summary.todayCalculations}
            sub={calcDeltaText}
            color={calcDelta >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <StatCard
            label="New Installs Today"
            value={summary.todayNewDevices}
            sub="unique devices"
          />
          <StatCard
            label="Cache Hit Rate"
            value={`${summary.cacheHitRate}%`}
            sub="last 30 days"
            color={summary.cacheHitRate >= 30 ? 'text-green-400' : 'text-yellow-400'}
          />
          <StatCard
            label="Errors (24h)"
            value={summary.errors24h}
            sub="API failures + fallbacks"
            color={summary.errors24h === 0 ? 'text-green-400' : 'text-red-400'}
          />
        </div>

        {/* Section 2 — Growth */}
        <SectionTitle>📈 Growth</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Devices"
            value={summary.totalDevices}
            sub="all time"
          />
          <StatCard
            label="Total Calculations"
            value={summary.totalCalculations}
            sub="all time"
          />
          <StatCard
            label="Last 7 Days"
            value={summary.last7DaysCalculations}
            sub="calculations"
          />
          <StatCard
            label="Avg per Device"
            value={summary.totalDevices > 0
              ? (summary.totalCalculations / summary.totalDevices).toFixed(1)
              : '0'}
            sub="calculations per user"
          />
        </div>

        {/* Daily calculations chart */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
          <p className="text-gray-400 text-sm font-medium mb-4">
            Daily Calculations (Last 30 Days)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={charts.dailyCalculations}>
              <XAxis
                dataKey="date"
                tick={{ fill: '#6B7280', fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8 }}
                labelStyle={{ color: '#F9FAFB' }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#7C3AED"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Section 3 — Usage Patterns */}
        <SectionTitle>🚌 Usage Patterns</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

          {/* Transport modes */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-gray-400 text-sm font-medium mb-4">Transport Modes</p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={charts.transportModes.map((d: any) => ({
                    ...d,
                    name: MODE_LABELS[d.mode] ?? d.mode,
                  }))}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }: any) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {charts.transportModes.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Planning modes */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-gray-400 text-sm font-medium mb-4">
              Planning Mode Split
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={charts.planningModes.map((d: any) => ({
                    ...d,
                    name: MODE_LABELS[d.mode] ?? d.mode,
                  }))}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }: any) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {charts.planningModes.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Hourly distribution */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 mb-4">
          <p className="text-gray-400 text-sm font-medium mb-4">
            Peak Calculation Hours — Manila Time (Last 7 Days)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={charts.hourlyDistribution}>
              <XAxis
                dataKey="label"
                tick={{ fill: '#6B7280', fontSize: 10 }}
                interval={2}
              />
              <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8 }}
                labelStyle={{ color: '#F9FAFB' }}
              />
              <Bar dataKey="count" fill="#7C3AED" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Section 4 — Rail Performance */}
        <SectionTitle>🚇 Rail Performance</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Rail Routes"
            value={summary.railCount}
            sub="last 30 days"
            color="text-purple-400"
          />
          <StatCard
            label="Ground Transit"
            value={summary.groundCount}
            sub="last 30 days"
          />
          <StatCard
            label="Rail Adoption"
            value={summary.totalCommute > 0
              ? `${Math.round((summary.railCount / summary.totalCommute) * 100)}%`
              : '0%'}
            sub="of commute calculations"
            color="text-purple-400"
          />
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-gray-400 text-sm font-medium">Avg Confidence</p>
            {charts.avgConfidenceByMode.map((d: any) => (
              <div key={d.mode} className="flex justify-between mt-2">
                <span className="text-gray-400 text-sm">
                  {MODE_LABELS[d.mode] ?? d.mode}
                </span>
                <span className="text-white font-semibold text-sm">
                  {d.avg}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 5 — Data Quality */}
        <SectionTitle>⚡ Data Quality</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

          {/* Data freshness */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-gray-400 text-sm font-medium mb-4">
              Data Freshness (Last 30 Days)
            </p>
            {charts.dataFreshness.map((d: any, i: number) => {
              const total = charts.dataFreshness.reduce(
                (sum: number, x: any) => sum + x.count, 0
              );
              const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
              return (
                <div key={d.type} className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-300 text-sm capitalize">
                      {MODE_LABELS[d.type] ?? d.type}
                    </span>
                    <span className="text-gray-400 text-sm">{d.count} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Weather conditions */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-gray-400 text-sm font-medium mb-4">
              Weather During Calculations (Last 30 Days)
            </p>
            {charts.weatherConditions.map((d: any, i: number) => {
              const total = charts.weatherConditions.reduce(
                (sum: number, x: any) => sum + x.count, 0
              );
              const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
              return (
                <div key={d.condition} className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-300 text-sm">
                      {MODE_LABELS[d.condition] ?? d.condition}
                    </span>
                    <span className="text-gray-400 text-sm">{d.count} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top corridors */}
        <SectionTitle>🗺️ Top Corridors (Last 30 Days)</SectionTitle>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-gray-400 text-sm font-medium px-5 py-3">
                  #
                </th>
                <th className="text-left text-gray-400 text-sm font-medium px-5 py-3">
                  Corridor
                </th>
                <th className="text-right text-gray-400 text-sm font-medium px-5 py-3">
                  Calculations
                </th>
              </tr>
            </thead>
            <tbody>
              {topCorridors.map((c: any, i: number) => (
                <tr
                  key={i}
                  className="border-b border-gray-800 last:border-0
                             hover:bg-gray-800 transition-colors"
                >
                  <td className="px-5 py-3 text-gray-500 text-sm">{i + 1}</td>
                  <td className="px-5 py-3 text-white text-sm">{c.corridor}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="bg-purple-900 text-purple-300 text-xs
                                     font-semibold px-2 py-1 rounded-full">
                      {c.count}
                    </span>
                  </td>
                </tr>
              ))}
              {topCorridors.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-gray-500 text-sm">
                    No corridor data yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-gray-600 text-xs text-center mt-8 pb-4">
          Airylio Admin Dashboard — Auto-refreshes every 60 seconds
        </p>
      </div>
    </div>
  );
}
