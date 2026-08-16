'use client';
import { useState, useEffect, useRef } from 'react';
import { fetchSuggestions, fetchPlaceDetails, PlaceSuggestion } from '@/lib/places';
import { getOrCreateSession } from '@/lib/supabase';
import { TripResult, TransportMode, PlanningMode } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatTime12h(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatTravelTime(leave: string, arrive: string): string {
  const mins = Math.round(
    (new Date(arrive).getTime() - new Date(leave).getTime()) / 60000
  );
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function confidenceColor(score: number): string {
  if (score >= 85) return 'var(--signal-green)';
  if (score >= 70) return 'var(--signal-warn)';
  return 'var(--signal-risk)';
}

function confidenceLabel(score: number): string {
  if (score >= 85) return 'High';
  if (score >= 70) return 'Moderate';
  return 'Low';
}

function freshnessLabel(f: string): string {
  if (f === 'live') return '● Live traffic';
  if (f === 'cached') return '⚡ Recent data';
  return '📊 Estimated';
}

function weatherLabel(w?: string): string {
  if (w === 'storm') return '⛈ Storm';
  if (w === 'heavy_rain') return '🌧 Heavy Rain';
  if (w === 'rain') return '🌦 Rain';
  return '☀ Clear';
}

function legIcon(type: string): string {
  if (type === 'walk') return '🚶';
  if (type === 'wait') return '⏳';
  if (type === 'transfer') return '🔄';
  return '🚇';
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning! ☀️';
  if (h >= 12 && h < 18) return 'Good afternoon! 🌤';
  if (h >= 18 && h < 21) return 'Good evening! 🌆';
  return 'Good night! 🌙';
}

function getLottieFile(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 8) return 'sunrise.json';
  if (h >= 8 && h < 18) return 'sunny.json';
  return 'night.json';
}

type Screen = 'plan' | 'loading' | 'result';

const TRANSPORT_OPTIONS: { value: TransportMode; label: string; icon: React.ReactNode }[] = [
  {
    value: 'drive',
    label: 'Drive',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h11l4 4 1 3H5"/>
        <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
        <path d="M14 7v4"/>
      </svg>
    ),
  },
  {
    value: 'public_commute',
    label: 'Commute',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" rx="2"/>
        <path d="M16 8h4l3 3v5h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
  },
  {
    value: 'motorcycle_taxi',
    label: 'Motorcycle',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/>
        <path d="M8 17h8M9 7l4 4h3l2-4"/>
        <path d="M14 11l1-4h2"/>
      </svg>
    ),
  },
  {
    value: 'walk',
    label: 'Walk',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="4" r="1"/>
        <path d="m6.5 6.5 3 3 2 5 3-3"/>
        <path d="m9.5 9.5-2 6 3 3"/>
        <path d="m12.5 12.5 2 5"/>
      </svg>
    ),
  },
];

// ── AddressInput ──────────────────────────────────────────────────────────────

interface AddressInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (place: { lat: number; lng: number; label: string }) => void;
  sessionToken: string;
  placeholder: string;
  icon: React.ReactNode;
  isConfirmed?: boolean;
}

function AddressInput({
  label, value, onChange, onSelect, sessionToken, placeholder, icon, isConfirmed,
}: AddressInputProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    onChange(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const s = await fetchSuggestions(v, sessionToken);
      setSuggestions(s);
      setOpen(s.length > 0);
    }, 300);
  }

  async function handleSelect(s: PlaceSuggestion) {
    onChange(s.description);
    setOpen(false);
    setSuggestions([]);
    setLookupFailed(false);
    const details = await fetchPlaceDetails(s.placeId, sessionToken);
    if (details) {
      onSelect(details);
    } else {
      // Without this the address sits in the box looking selected while the
      // coordinates are still null, and Calculate stays disabled with nothing
      // on screen explaining why.
      setLookupFailed(true);
    }
  }

  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <label style={{
        display: 'block',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: 6,
        fontFamily: 'var(--font-body)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon}<span>{label}</span></span>
      </label>
      <input
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 300)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '12px 16px',
          borderRadius: 12,
          border: `1.5px solid ${isConfirmed ? 'var(--signal-green)' : 'var(--border)'}`,
          background: 'var(--bg)',
          color: 'var(--text-primary)',
          fontSize: 15,
          fontFamily: 'var(--font-body)',
          outline: 'none',
          transition: 'border-color 0.2s',
        }}
        onFocusCapture={e => {
          (e.target as HTMLInputElement).style.borderColor = 'var(--primary)';
        }}
        onBlurCapture={e => {
          // Restore the confirmed colour, not the neutral one - this handler
          // writes borderColor directly and would otherwise clear the green.
          (e.target as HTMLInputElement).style.borderColor =
            isConfirmed ? 'var(--signal-green)' : 'var(--border)';
        }}
      />
      {lookupFailed && (
        <p style={{
          fontSize: 12, color: 'var(--signal-risk)',
          fontFamily: 'var(--font-body)', marginTop: 6,
        }}>
          Could not look up that address. Please pick another suggestion.
        </p>
      )}
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 24px var(--shadow)',
          zIndex: 100,
          maxHeight: 240,
          overflowY: 'auto',
          marginTop: 4,
        }}>
          {suggestions.map(s => (
            <div
              key={s.placeId}
              onMouseDown={() => handleSelect(s)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--text-primary)',
                borderBottom: '1px solid var(--border)',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--card)';
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {s.description}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ConfidenceRing ────────────────────────────────────────────────────────────

function ConfidenceRing({ score }: { score: number }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = confidenceColor(score);

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius}
          fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="6" />
        <circle cx="40" cy="40" r={radius}
          fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 40 40)" />
        <text x="40" y="36" textAnchor="middle"
          fill="white" fontSize="14" fontWeight="700"
          fontFamily="'Plus Jakarta Sans', sans-serif">
          {Math.round(score)}%
        </text>
        <text x="40" y="52" textAnchor="middle"
          fill="rgba(255,255,255,0.7)" fontSize="10"
          fontFamily="'Inter', sans-serif">
          {confidenceLabel(score)}
        </text>
      </svg>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [isDark, setIsDark] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  // Both depend on the current hour. Computed on mount rather than during
  // render: this page is statically prerendered, so rendering them directly
  // would bake the build machine's time into the HTML and mismatch on hydration.
  const [greeting, setGreeting] = useState('');
  const [lottieFile, setLottieFile] = useState('sunny.json');

  // Form state
  const [originLabel, setOriginLabel] = useState('');
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destLabel, setDestLabel] = useState('');
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [transport, setTransport] = useState<TransportMode>('drive');
  const [planningMode, setPlanningMode] = useState<PlanningMode>('arrive_by');
  const [targetDate, setTargetDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });

  // Result state
  const [result, setResult] = useState<TripResult | null>(null);
  const [screen, setScreen] = useState<Screen>('plan');
  const [error, setError] = useState<string | null>(null);
  const [breakdownExpanded, setBreakdownExpanded] = useState(true);

  // Countdown
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    // Theme
    const saved = localStorage.getItem('airylio-theme');
    if (saved === 'dark') {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
    // Places session token. Generated here rather than in a useState
    // initialiser so it is not also produced during server rendering and
    // thrown away.
    setSessionToken(crypto.randomUUID());
    // Time-of-day content
    setGreeting(getGreeting());
    setLottieFile(getLottieFile());
    // Auth
    getOrCreateSession().then(setAuthToken);
  }, []);

  useEffect(() => {
    if (!result) { setCountdown(null); return; }
    const activeResult = result;
    function tick() {
      const diff = new Date(activeResult.recommendedLeaveTime).getTime() - Date.now();
      const mins = Math.round(diff / 60000);
      const secs = Math.floor(diff / 1000);
      if (secs <= 0) {
        setCountdown(Math.round(-diff / 60000) < 1 ? 'Leave now' : `Overdue by ${Math.round(-diff / 60000)} min`);
      } else if (mins < 1) {
        setCountdown('Leave now');
      } else if (mins < 60) {
        setCountdown(`Leave in ${mins} min`);
      } else {
        setCountdown(`Leave in ${Math.floor(mins / 60)}h ${mins % 60}m`);
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [result]);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('airylio-theme', next ? 'dark' : 'light');
  }

  function formatDateTimeLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function handleCalculate() {
    if (!originCoords || !destCoords) {
      setError('Please select both origin and destination from the suggestions.');
      return;
    }
    if (!authToken) {
      setError('Session not ready. Please refresh the page.');
      return;
    }
    setScreen('loading');
    setError(null);
    setResult(null);

    try {
      const res = await fetch(process.env.NEXT_PUBLIC_EDGE_FUNCTION_URL!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          originLat: originCoords.lat,
          originLng: originCoords.lng,
          destLat: destCoords.lat,
          destLng: destCoords.lng,
          planningMode,
          targetTime: targetDate.toISOString(),
          transportMode: transport,
          originLabel,
          destinationLabel: destLabel,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Calculation failed');
      }

      const data = await res.json();
      setResult(data);
      setScreen('result');
    } catch (e: any) {
      // Back to the form rather than an empty result screen - the error banner
      // lives there, so this is the only place the message is visible.
      setError(e.message ?? 'Something went wrong. Please try again.');
      setScreen('plan');
    }
  }

  const canCalculate = !!originCoords && !!destCoords && screen !== 'loading';

  const mapsTravelMode =
    transport === 'public_commute' ? 'transit'
      : transport === 'walk' ? 'walking'
        : 'driving';

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Header with background image and lottie */}
      <header style={{
        position: 'relative',
        overflow: 'hidden',
        background: isDark
          ? 'linear-gradient(135deg, #0A0C1E 0%, #12153D 100%)'
          : 'linear-gradient(135deg, #F4F6FF 0%, #E8EAFF 100%)',
        padding: '48px 24px 32px',
        borderBottom: '1px solid var(--border)',
      }}>
        {/* Background image - top right like mobile app */}
        <img
          src="/main_bg.png"
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 40,
            right: -20,
            width: 180,
            height: 150,
            objectFit: 'contain',
            opacity: isDark ? 0.15 : 0.25,
            pointerEvents: 'none',
          }}
        />

        {/* Lottie animation - weather based */}
        <div style={{
          position: 'absolute',
          top: 44,
          right: 90,
          width: 70,
          height: 70,
          opacity: 0.7,
          pointerEvents: 'none',
        }}>
          <iframe
            src={`/lottie-player.html?file=${lottieFile}`}
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
            title="weather animation"
          />
        </div>

        {/* Logo row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src="/icon-192.png"
              alt="Airylio"
              style={{ width: 40, height: 40, borderRadius: 10 }}
            />
            <span style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700, fontSize: 20,
              color: 'var(--text-primary)',
            }}>
              Airylio
            </span>
          </div>
          <button
            onClick={toggleTheme}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '8px 12px',
              cursor: 'pointer', fontSize: 16,
              boxShadow: '0 2px 8px var(--shadow)',
            }}
            aria-label="Toggle theme"
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Greeting */}
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(1.4rem, 4vw, 1.8rem)',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 4,
            minHeight: '1.2em',
          }}>
            {greeting}
          </h1>
          <p style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-body)',
          }}>
            Where are you headed today?
          </p>
        </div>
      </header>

      {/* Main content */}
      <main style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 48px' }}>

        {/* Plan card */}
        <div style={{
          background: 'var(--card)',
          borderRadius: 20,
          padding: 24,
          boxShadow: '0 8px 32px var(--shadow)',
          border: '1px solid var(--border)',
          marginBottom: 20,
        }}>

          {/* Planning mode toggle */}
          <div style={{
            display: 'flex', gap: 8, marginBottom: 20,
            background: 'var(--bg)',
            borderRadius: 12, padding: 4,
          }}>
            {(['arrive_by', 'leave_at'] as PlanningMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setPlanningMode(mode)}
                style={{
                  flex: 1, padding: '8px 12px',
                  borderRadius: 10, border: 'none',
                  background: planningMode === mode ? 'var(--primary)' : 'transparent',
                  color: planningMode === mode ? '#fff' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600, fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {mode === 'arrive_by' ? '🚩 Arrive By' : '🚀 Leave At'}
              </button>
            ))}
          </div>

          {/* Origin */}
          <AddressInput
            label="From"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4C4F9E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 13 8 13s8-7.6 8-13a8 8 0 0 0-8-8z"/>
              </svg>
            }
            placeholder="Search origin address..."
            value={originLabel}
            onChange={v => { setOriginLabel(v); setOriginCoords(null); }}
            onSelect={p => { setOriginCoords(p); setOriginLabel(p.label); }}
            sessionToken={sessionToken}
            isConfirmed={!!originCoords}
          />

          {/* Destination */}
          <AddressInput
            label="To"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4C4F9E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            }
            placeholder="Search destination address..."
            value={destLabel}
            onChange={v => { setDestLabel(v); setDestCoords(null); }}
            onSelect={p => { setDestCoords(p); setDestLabel(p.label); }}
            sessionToken={sessionToken}
            isConfirmed={!!destCoords}
          />

          {/* Date/Time */}
          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              color: 'var(--text-secondary)', marginBottom: 6,
              fontFamily: 'var(--font-body)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              🕐 {planningMode === 'arrive_by' ? 'Arrive by' : 'Leave at'}
            </label>
            <input
              type="datetime-local"
              value={formatDateTimeLocal(targetDate)}
              onChange={e => setTargetDate(new Date(e.target.value))}
              style={{
                width: '100%', padding: '12px 16px',
                borderRadius: 12,
                border: '1.5px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text-primary)',
                fontSize: 15,
                fontFamily: 'var(--font-body)',
                outline: 'none',
              }}
            />
          </div>

          {/* Transport modes */}
          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              color: 'var(--text-secondary)', marginBottom: 8,
              fontFamily: 'var(--font-body)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Transport
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {TRANSPORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTransport(opt.value)}
                  style={{
                    flex: 1, padding: '10px 4px',
                    borderRadius: 12,
                    border: transport === opt.value
                      ? '2px solid var(--primary)'
                      : '2px solid var(--border)',
                    background: transport === opt.value
                      ? 'rgba(76,79,158,0.1)' : 'var(--bg)',
                    color: transport === opt.value
                      ? 'var(--primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    fontWeight: 600, fontSize: 11,
                    textAlign: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ marginBottom: 4 }}>{opt.icon}</div>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: '10px 14px',
              color: '#EF4444', fontSize: 13,
              fontFamily: 'var(--font-body)',
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          {/* Calculate button */}
          <button
            onClick={handleCalculate}
            disabled={!canCalculate}
            style={{
              width: '100%', padding: '16px',
              borderRadius: 14, border: 'none',
              background: canCalculate
                ? 'linear-gradient(135deg, #4C4F9E 0%, #7B7FD4 100%)'
                : 'var(--border)',
              color: canCalculate ? '#fff' : 'var(--text-secondary)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700, fontSize: 16,
              cursor: canCalculate ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              letterSpacing: '0.01em',
              boxShadow: canCalculate ? '0 4px 16px rgba(76,79,158,0.4)' : 'none',
            }}
          >
            {screen === 'loading' ? 'Calculating...' : 'Calculate Departure'}
          </button>
        </div>

        {/* Loading screen */}
        {screen === 'loading' && (
          <div style={{
            position: 'fixed', inset: 0,
            background: 'var(--bg)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
            animation: 'screen-in 0.2s ease-out',
          }}>
            <div style={{ marginBottom: 24 }}>
              <div className="pulse-ring" />
            </div>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18, fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 8,
            }}>Calculating your route...</p>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14, color: 'var(--text-secondary)',
            }}>Checking live traffic &amp; weather</p>
          </div>
        )}

        {/* Result screen. A fixed overlay, so its position inside <main> does
            not affect layout - no ancestor here sets transform/filter, which
            would otherwise make it a containing block and break `inset: 0`.
            Leaving it in place keeps the whole result body untouched. */}
        {screen === 'result' && result && (
          <div style={{
            position: 'fixed', inset: 0,
            background: 'var(--bg)',
            overflowY: 'auto',
            zIndex: 900,
            animation: 'screen-in 0.25s ease-out',
          }}>
          <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 0 32px' }}>
            <div style={{ padding: '16px 20px 12px' }}>
              <button
                onClick={() => setScreen('plan')}
                aria-label="Back to plan"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  minHeight: 44, padding: '0 12px 0 4px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 15, fontWeight: 600,
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1 }}>&#8592;</span>
                Back
              </button>
            </div>
          <div style={{
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 4px 24px var(--shadow)',
            border: '1px solid var(--border)',
            margin: '0 20px 20px',
          }}>

            {/* Hero */}
            <div style={{
              background: 'linear-gradient(135deg, #12153D 0%, #1a1f5c 100%)',
              padding: '28px 24px 24px',
            }}>
              {/* Freshness + weather badges */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: result.dataFreshness === 'live' ? '#12B886' : '#F59E0B',
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: 20, padding: '4px 10px',
                  fontFamily: 'var(--font-body)',
                }}>
                  {freshnessLabel(result.dataFreshness)}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: '#fff',
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: 20, padding: '4px 10px',
                  fontFamily: 'var(--font-body)',
                }}>
                  {weatherLabel(result.weatherCondition)}
                </span>
              </div>

              {/* Leave time + confidence ring */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 500,
                    color: 'rgba(255,255,255,0.7)',
                    fontFamily: 'var(--font-body)',
                    marginBottom: 4,
                  }}>
                    {planningMode === 'arrive_by' ? 'Leave at' : 'If you leave at'}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(2rem, 8vw, 2.8rem)',
                    fontWeight: 700, color: '#fff',
                    lineHeight: 1,
                  }}>
                    {formatTime12h(result.recommendedLeaveTime)}
                  </div>
                  {countdown && (
                    <div style={{
                      fontSize: 13, fontWeight: 600,
                      color: 'rgba(255,255,255,0.9)',
                      fontFamily: 'var(--font-body)',
                      marginTop: 4,
                    }}>
                      {countdown}
                    </div>
                  )}
                  <div style={{
                    fontSize: 13, color: 'rgba(255,255,255,0.7)',
                    fontFamily: 'var(--font-body)', marginTop: 4,
                  }}>
                    {planningMode === 'arrive_by' ? 'Arrive by ' : 'Est. arrival '}
                    {formatTime12h(result.predictedArrivalTime)}
                  </div>
                </div>
                <ConfidenceRing score={result.confidenceScore} />
              </div>
            </div>

            {/* Body */}
            <div style={{
              background: 'var(--card)',
              padding: '20px 24px',
            }}>

              {/* Why this recommendation */}
              {(result.confidenceReason?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-body)',
                    marginBottom: 8,
                  }}>
                    Why this recommendation
                  </div>
                  {result.confidenceReason.map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                      marginBottom: 6,
                      fontSize: 13, color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-body)',
                    }}>
                      <span>•</span>
                      <span>{r.replace('heavy_rain', 'Heavy Rain').replace('_rain', ' Rain')}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Trip stats */}
              <div style={{
                display: 'flex', gap: 16, alignItems: 'center',
                padding: '12px 0',
                borderTop: '1px solid var(--border)',
                borderBottom: result.commuteBreakdown ? 'none' : '1px solid var(--border)',
                fontSize: 13, fontFamily: 'var(--font-body)',
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  ⏱ {formatTravelTime(result.recommendedLeaveTime, result.predictedArrivalTime)}
                </span>
                {!!result.distanceMeters && !result.commuteBreakdown && (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    📍 {(result.distanceMeters / 1000).toFixed(1)} km
                  </span>
                )}
                <span style={{ color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                  {result.commuteBreakdown
                    ? `🚇 ${result.commuteBreakdown.via}`
                    : '🌐 Google Routes'}
                </span>
              </div>

              {/* Rail breakdown */}
              {result.commuteBreakdown && (
                <div style={{ marginTop: 16 }}>
                  <button
                    onClick={() => setBreakdownExpanded(p => !p)}
                    style={{
                      width: '100%', background: 'none',
                      border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 0', marginBottom: 8,
                    }}
                  >
                    <span style={{
                      fontSize: 13, fontWeight: 600,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-body)',
                    }}>
                      Your commute via {result.commuteBreakdown.via}
                    </span>
                    <span style={{
                      fontSize: 12, color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-body)',
                    }}>
                      {breakdownExpanded ? '▲' : '▼ Tap to expand'}
                    </span>
                  </button>

                  {breakdownExpanded && (
                    <div>
                      {result.commuteBreakdown.legs.map((leg, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 0',
                          fontSize: 13, fontFamily: 'var(--font-body)',
                          borderBottom: i < result.commuteBreakdown!.legs.length - 1
                            ? '1px solid var(--border)' : 'none',
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {legIcon(leg.type)} {leg.label}
                          </span>
                          <span style={{
                            color: 'var(--text-primary)', fontWeight: 600,
                          }}>
                            {Math.round(leg.seconds / 60) < 1
                              ? '< 1 min'
                              : `${Math.round(leg.seconds / 60)} min`}
                          </span>
                        </div>
                      ))}
                      {result.commuteBreakdown.queuePenaltySeconds > 0 && (
                        <div style={{
                          fontSize: 12, color: '#F59E0B',
                          fontFamily: 'var(--font-body)',
                          marginTop: 8,
                        }}>
                          ⚠️ Rush hour queue: +{Math.round(
                            result.commuteBreakdown.queuePenaltySeconds / 60
                          )} min
                        </div>
                      )}
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        marginTop: 10, padding: '8px 0',
                        borderTop: '1px solid var(--border)',
                        fontSize: 13, fontWeight: 600,
                        fontFamily: 'var(--font-body)',
                        color: 'var(--text-primary)',
                      }}>
                        <span>✅ Total</span>
                        <span>{result.commuteBreakdown.totalMinutes} min</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Open in Google Maps */}
              {originCoords && destCoords && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lng}&destination=${destCoords.lat},${destCoords.lng}&travelmode=${mapsTravelMode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 8,
                    marginTop: 16, padding: '12px',
                    borderRadius: 12,
                    background: 'rgba(76,79,158,0.1)',
                    border: '1px solid rgba(76,79,158,0.3)',
                    color: 'var(--primary)',
                    fontFamily: 'var(--font-body)',
                    fontWeight: 600, fontSize: 14,
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  🗺️ Open in Google Maps
                </a>
              )}
            </div>
          </div>
          </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          textAlign: 'center', marginTop: 32,
          fontSize: 12, color: 'var(--text-secondary)',
          fontFamily: 'var(--font-body)',
        }}>
          <p>Powered by Google Routes &amp; Open-Meteo</p>
          <p style={{ marginTop: 4 }}>
            <a href="https://airylio.com" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              airylio.com
            </a>
            {' · '}
            <a href="https://airylio.com/privacy.html" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              Privacy
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
