import { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable, ActivityIndicator, ScrollView, Platform, Modal, TouchableWithoutFeedback, Keyboard, Image } from 'react-native';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import DestinationAutocomplete from './components/DestinationAutocomplete';
import TimePickerModal from './components/TimePickerModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ConfidenceRing from './components/ConfidenceRing';
import LoadingRecommendation from './components/LoadingRecommendation';
import { supabase } from './lib/supabase';
import LottieView from 'lottie-react-native';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY!;

const COLORS = {
  ink: '#12153D',
  accent: '#4C4F9E',
  accentTint: 'rgba(76,79,158,0.07)',
  signalGood: '#12B886',
  signalWarn: '#F5A623',
  signalRisk: '#E85D51',
  canvas: '#FAFAFC',
  card: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B6F8A',
  divider: '#E7E7F1',
};

// TEMP: force Philippine Standard Time (UTC+8) for testing
const PST_OFFSET_MS = (8 * 60 + new Date().getTimezoneOffset()) * 60000;
function nowPST(): number { return Date.now() + PST_OFFSET_MS; }

type PlanningMode = 'arrive_by' | 'leave_at';

const TRANSPORT_MODES: {
  key: string;
  label: string;
  iconSet: 'ion' | 'mci';
  iconName: string;
}[] = [
  { key: 'drive', label: 'Drive', iconSet: 'ion', iconName: 'car' },
  { key: 'motorcycle_taxi', label: 'Motorcycle', iconSet: 'mci', iconName: 'motorbike' },
  { key: 'public_commute', label: 'Commute', iconSet: 'ion', iconName: 'bus' },
  { key: 'walk', label: 'Walk', iconSet: 'ion', iconName: 'walk' },
];

interface ExplanationFactor {
  type: 'weather' | 'rush_hour' | 'buffer_cap';
  label: string;
  minutesAdded: number;
}

interface TripResult {
  tripId: string;
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  dataFreshness: string;
  distanceMeters?: number;
  weatherCondition?: 'clear' | 'rain' | 'heavy_rain' | 'storm';
  recommendationExplanation?: {
    planningMode?: PlanningMode;
    factors: ExplanationFactor[];
  };
}

interface Coords {
  lat: number;
  lng: number;
}

interface RecentDestination {
  label: string;
  lat: number;
  lng: number;
}

const RECENT_DESTINATIONS_KEY = 'airylio:recentDestinations';
const RECENT_ORIGINS_KEY = 'airylio:recentOrigins';
const MAX_RECENT_DESTINATIONS = 8;

function startOfToday(): Date {
  const d = new Date(nowPST());
  d.setHours(0, 0, 0, 0);
  return d;
}

function combineDateAndTime(date: Date, time: Date): Date {
  const combined = new Date(date);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}

function formatTime12h(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function confidenceColor(score: number): string {
  if (score >= 85) return COLORS.signalGood;
  if (score >= 70) return COLORS.signalWarn;
  return COLORS.signalRisk;
}

function formatTravelTime(leaveTime: string, arrivalTime: string): string {
  const ms = new Date(arrivalTime).getTime() - new Date(leaveTime).getTime();
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  return `${minutes} min`;
}

function formatDistance(meters?: number): string | null {
  if (meters === undefined) return null;
  return `${(meters / 1000).toFixed(1)} km`;
}

function freshnessLabel(freshness: string): { text: string; color: string } {
  if (freshness === 'live') return { text: 'Live traffic', color: COLORS.signalGood };
  if (freshness === 'cached') return { text: 'Recent data', color: COLORS.signalWarn };
  return { text: 'Estimated', color: COLORS.textSecondary };
}

function reasonIcon(reason: string): { name: string; color: string } {
  const lower = reason.toLowerCase();
  if (lower.includes('rain') || lower.includes('storm') || lower.includes('weather')) {
    return { name: 'rainy', color: '#4A90D9' };
  }
  if (lower.includes('rush') || lower.includes('traffic') || lower.includes('congestion')) {
    return { name: 'car', color: COLORS.accent };
  }
  if (lower.includes('cached') || lower.includes('historical') || lower.includes('estimate')) {
    return { name: 'stats-chart', color: COLORS.textSecondary };
  }
  if (lower.includes('buffer') || lower.includes('minute')) {
    return { name: 'time', color: COLORS.signalWarn };
  }
  return { name: 'checkmark-circle', color: COLORS.signalGood };
}

function factorIcon(type: 'weather' | 'rush_hour' | 'buffer_cap'): { name: string; color: string } {
  if (type === 'weather') return { name: 'rainy', color: '#4A90D9' };
  if (type === 'rush_hour') return { name: 'car', color: COLORS.accent };
  return { name: 'time', color: COLORS.signalWarn }; // buffer_cap
}

function weatherIndicator(condition?: 'clear' | 'rain' | 'heavy_rain' | 'storm'): { icon: string; label: string; color: string } {
  if (condition === 'storm') return { icon: 'thunderstorm', label: 'Storm', color: '#7B5EA7' };
  if (condition === 'heavy_rain') return { icon: 'rainy', label: 'Heavy Rain', color: '#4A90D9' };
  if (condition === 'rain') return { icon: 'rainy-outline', label: 'Rain', color: '#4A90D9' };
  return { icon: 'sunny', label: 'Clear', color: COLORS.signalGood };
}

function getWeatherAnimation(
  condition?: 'clear' | 'rain' | 'heavy_rain' | 'storm'
): any {
  const h = new Date(nowPST()).getHours();
  if (condition === 'storm' || condition === 'heavy_rain') return require('./assets/lottie/storm.json');
  if (condition === 'rain') return require('./assets/lottie/rain.json');
  if (h >= 5 && h < 8) return require('./assets/lottie/sunrise.json');
  if (h >= 8 && h < 18) return require('./assets/lottie/sunny.json');
  return require('./assets/lottie/night.json');
}

function getGreeting(): string {
  const hour = new Date(nowPST()).getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export default function App() {
  const [gpsCoords, setGpsCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [originCoords, setOriginCoords] = useState<Coords | null>(null);
  const [originLabel, setOriginLabel] = useState('Current Location');
  const [originEditing, setOriginEditing] = useState(false);

  const [destCoords, setDestCoords] = useState<Coords | null>(null);
  const [destLabel, setDestLabel] = useState('');
  const [recentDestinations, setRecentDestinations] = useState<RecentDestination[]>([]);
  const [recentOrigins, setRecentOrigins] = useState<RecentDestination[]>([]);

  const [planningMode, setPlanningMode] = useState<PlanningMode>('arrive_by');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [selectedTime, setSelectedTime] = useState<Date>(new Date(nowPST() + 60 * 60 * 1000));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [selectedMode, setSelectedMode] = useState('drive');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TripResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headerWeather, setHeaderWeather] = useState<'clear' | 'rain' | 'heavy_rain' | 'storm'>('clear');

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Please search for your origin manually.');
        return;
      }
      try {
        const position = await Location.getCurrentPositionAsync({});
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        setGpsCoords(coords);
        setOriginCoords(coords);
        setOriginLabel('Current Location');
      } catch {
        setLocationError('Could not detect your current location. Please search for your origin manually.');
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENT_DESTINATIONS_KEY);
        if (stored) setRecentDestinations(JSON.parse(stored));
      } catch {
        // Non-critical: recent destinations are a convenience feature, fail silently.
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENT_ORIGINS_KEY);
        if (stored) setRecentOrigins(JSON.parse(stored));
      } catch {
        // Non-critical: recent origins are a convenience feature, fail silently.
      }
    })();
  }, []);

  useEffect(() => {
    if (!gpsCoords) return;
    (async () => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${gpsCoords.lat}&longitude=${gpsCoords.lng}&current=weathercode&timezone=auto`
        );
        if (res.ok) {
          const data = await res.json();
          const code = data?.current?.weathercode ?? -1;
          if (code >= 96) setHeaderWeather('storm');
          else if (code >= 95) setHeaderWeather('heavy_rain');
          else if (code >= 80 || (code >= 51 && code <= 67)) setHeaderWeather('rain');
          else setHeaderWeather('clear');
        }
      } catch {
        // silent fallback to 'clear'
      }
    })();
  }, [gpsCoords]);

  async function addRecentDestination(item: RecentDestination) {
    const deduped = recentDestinations.filter((d) => d.label !== item.label);
    const updated = [item, ...deduped].slice(0, MAX_RECENT_DESTINATIONS);
    setRecentDestinations(updated);
    try {
      await AsyncStorage.setItem(RECENT_DESTINATIONS_KEY, JSON.stringify(updated));
    } catch {
      // Non-critical: local cache write failure shouldn't block the calculation flow.
    }
  }

  async function addRecentOrigin(item: RecentDestination) {
    const deduped = recentOrigins.filter((d) => d.label !== item.label);
    const updated = [item, ...deduped].slice(0, MAX_RECENT_DESTINATIONS);
    setRecentOrigins(updated);
    try {
      await AsyncStorage.setItem(RECENT_ORIGINS_KEY, JSON.stringify(updated));
    } catch {
      // Non-critical: local cache write failure shouldn't block the calculation flow.
    }

  }

  function useCurrentLocation() {
    if (!gpsCoords) return;
    setOriginCoords(gpsCoords);
    setOriginLabel('Current Location');
    setOriginEditing(false);
  }

  const showGpsChip = originLabel === 'Current Location' && !!originCoords && !originEditing;
  const showManualChip = originLabel !== 'Current Location' && !!originCoords && !originEditing;

  const selectedDateTime = combineDateAndTime(selectedDate, selectedTime);
  const LEAVE_AT_GRACE_MS = 2 * 60 * 1000;
  const isValidDepartureTime = selectedDateTime.getTime() >= nowPST() - LEAVE_AT_GRACE_MS;
  const canCalculate = !!originCoords && !!destCoords && isValidDepartureTime && !loading;

  async function handleCalculate() {
    if (!originCoords || !destCoords) return;

    setLoading(true);
    setError(null);
    setResult(null);
    const loadingStartedAt = Date.now();
    const MIN_LOADING_MS = 1000;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const { error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw authError;
      }

      const { data, error: fnError } = await supabase.functions.invoke('calculate-trip', {
        body: {
          originLat: originCoords.lat,
          originLng: originCoords.lng,
          destLat: destCoords.lat,
          destLng: destCoords.lng,
          planningMode,
          targetTime: selectedDateTime.toISOString(),
          transportMode: selectedMode,
        },
      });

      if (fnError) {
        const bodyText = await fnError.context?.text?.();
        const message = bodyText || fnError.message;
        if (message.includes('no historical estimate available')) {
          throw new Error("This route isn't available for the selected transport mode yet. Try a different mode.");
        }
        throw new Error(message);
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      const elapsed = Date.now() - loadingStartedAt;
      const remaining = MIN_LOADING_MS - elapsed;
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      setLoading(false);
    }
  }

  const freshness = result ? freshnessLabel(result.dataFreshness) : null;
  // Read the mode from the result itself (echoed back by the engine), not the
  // live toggle state - the toggle can't actually change while the result
  // modal is open, but this is the more correct source of truth regardless.
  const resultMode: PlanningMode = result?.recommendationExplanation?.planningMode ?? planningMode;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Image source={require('./assets/main_bg.png')} style={styles.headerBgImage} resizeMode="contain" />
        <LottieView
          source={getWeatherAnimation(headerWeather)}
          autoPlay
          loop
          style={styles.headerLottie}
        />
        <View style={styles.logoRow}>
          <Image source={require('./assets/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.logoText}>Airylio</Text>
        </View>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.greetingSub}>Where are you headed?</Text>
      </View>

      <View style={styles.card}>
        {/* Planning mode toggle - first-class, not a subtle segmented control */}
        <View style={styles.modeToggleRow}>
          <Pressable
            style={[styles.modeToggleButton, planningMode === 'arrive_by' && styles.modeToggleButtonSelected]}
            onPress={() => setPlanningMode('arrive_by')}
          >
            <Ionicons name="flag" size={15} color={planningMode === 'arrive_by' ? '#fff' : COLORS.textSecondary} />
            <Text style={[styles.modeToggleText, planningMode === 'arrive_by' && styles.modeToggleTextSelected]}>
              Arrive By
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeToggleButton, planningMode === 'leave_at' && styles.modeToggleButtonSelected]}
            onPress={() => setPlanningMode('leave_at')}
          >
            <Ionicons name="rocket" size={15} color={planningMode === 'leave_at' ? '#fff' : COLORS.textSecondary} />
            <Text style={[styles.modeToggleText, planningMode === 'leave_at' && styles.modeToggleTextSelected]}>
              Leave At
            </Text>
          </Pressable>
        </View>

        {/* From */}
        <View style={styles.fieldRow}>
          <View style={[styles.fieldDot, { backgroundColor: COLORS.accent }]} />
          <View style={styles.fieldTextCol}>
            <Text style={styles.fieldLabel}>From</Text>
            {showGpsChip ? (
              <Pressable onPress={() => setOriginEditing(true)}>
                <Text style={styles.fieldValue}>Your current location</Text>
              </Pressable>
            ) : showManualChip ? (
              <Pressable onPress={() => setOriginEditing(true)}>
                <Text style={styles.fieldValue} numberOfLines={1}>{originLabel}</Text>
              </Pressable>
            ) : (
              <DestinationAutocomplete
                apiKey={GOOGLE_PLACES_API_KEY}
                recentDestinations={recentOrigins}
                placeholder={locationError ?? 'Search origin'}
                suggestedLabel="Suggested Locations"
                autoFocus={originEditing}
                dropdownOffsetLeft={-35}
                dropdownOffsetRight={gpsCoords ? -44 : -14}
                colors={{
                  accent: COLORS.accent,
                  textPrimary: COLORS.textPrimary,
                  textSecondary: COLORS.textSecondary,
                  divider: COLORS.divider,
                  card: COLORS.card,
                  signalRisk: COLORS.signalRisk,
                  ink: COLORS.ink,
                }}
                onSelect={(place) => {
                  setOriginLabel(place.label);
                  setOriginCoords({ lat: place.lat, lng: place.lng });
                  setOriginEditing(false);
                  addRecentOrigin(place);
                }}
              />
            )}
          </View>
          {gpsCoords && !showGpsChip && (
            <Pressable onPress={useCurrentLocation}>
              <Ionicons name="locate-outline" size={18} color={COLORS.textSecondary} />
            </Pressable>
          )}
          {showGpsChip && <Ionicons name="locate" size={18} color={COLORS.accent} />}
        </View>

        {/* To */}
        <View style={{ position: 'relative' }}>
        {destLabel ? (
          <Pressable
            style={styles.fieldRow}
            onPress={() => {
              setDestCoords(null);
              setDestLabel('');
            }}
          >
            <Ionicons name="location" size={16} color={COLORS.signalRisk} style={styles.fieldPinIcon} />
            <View style={styles.fieldTextCol}>
              <Text style={styles.fieldLabel}>To</Text>
              <Text style={styles.fieldValue} numberOfLines={1}>{destLabel}</Text>
            </View>
            <Ionicons name="close" size={18} color={COLORS.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.fieldRow}>
            <Ionicons name="location" size={16} color={COLORS.signalRisk} style={styles.fieldPinIcon} />
            <View style={styles.fieldTextCol}>
              <Text style={styles.fieldLabel}>To</Text>
              <DestinationAutocomplete
                apiKey={GOOGLE_PLACES_API_KEY}
                recentDestinations={recentDestinations}
                dropdownOffsetLeft={-42}
                dropdownOffsetRight={-14}
                colors={{
                  accent: COLORS.accent,
                  textPrimary: COLORS.textPrimary,
                  textSecondary: COLORS.textSecondary,
                  divider: COLORS.divider,
                  card: COLORS.card,
                  signalRisk: COLORS.signalRisk,
                  ink: COLORS.ink,
                }}
                onSelect={(place) => {
                  setDestCoords({ lat: place.lat, lng: place.lng });
                  setDestLabel(place.label);
                  addRecentDestination(place);
                }}
              />
            </View>
          </View>
        )}
        </View>

        <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
          {/* Date & time - the main focal point, styled prominently */}
          <Text style={styles.dateTimeSectionLabel}>
            {planningMode === 'arrive_by' ? 'Arrival date & time' : 'Departure date & time'}
          </Text>
          <View style={styles.dateTimeCard}>
            <Pressable style={styles.dateTimeHalf} onPress={() => setShowDatePicker(true)}>
              <View style={styles.dateTimeIconWrap}>
                <Ionicons name="calendar" size={18} color="#fff" />
              </View>
              <View>
                <Text style={styles.dateTimeSmallLabel}>Date</Text>
                <Text style={styles.dateTimeBigValue}>
                  {selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </Text>
              </View>
            </Pressable>
            <View style={styles.dateTimeDividerVertical} />
            <Pressable style={styles.dateTimeHalf} onPress={() => setShowTimePicker(true)}>
              <View style={styles.dateTimeIconWrap}>
                <Ionicons name="time" size={18} color="#fff" />
              </View>
              <View>
                <Text style={styles.dateTimeSmallLabel}>Time</Text>
                <Text style={styles.dateTimeBigValue}>
                  {selectedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                </Text>
              </View>
            </Pressable>
          </View>
          {!isValidDepartureTime && (
            <Text style={styles.warning}>{planningMode === 'arrive_by' ? 'Arrival time must be in the future.' : 'Departure time must be in the future.'}</Text>
          )}

          {showDatePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              minimumDate={startOfToday()}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selected) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (selected) setSelectedDate(selected);
              }}
            />
          )}
          <TimePickerModal
            visible={showTimePicker}
            value={selectedTime}
            colors={{
              accent: COLORS.accent,
              ink: COLORS.ink,
              card: COLORS.card,
              canvas: COLORS.canvas,
              textPrimary: COLORS.textPrimary,
              textSecondary: COLORS.textSecondary,
              divider: COLORS.divider,
            }}
            onConfirm={(selected) => {
              setSelectedTime(selected);
              setShowTimePicker(false);
            }}
            onCancel={() => setShowTimePicker(false)}
          />

          <View style={styles.transportRow}>
            {TRANSPORT_MODES.map((mode) => {
              const selected = selectedMode === mode.key;
              const IconComponent = mode.iconSet === 'mci' ? MaterialCommunityIcons : Ionicons;
              return (
                <Pressable
                  key={mode.key}
                  style={[styles.transportPill, selected && styles.transportPillSelected]}
                  onPress={() => setSelectedMode(mode.key)}
                >
                  <IconComponent
                    name={mode.iconName as any}
                    size={18}
                    color={selected ? '#fff' : COLORS.accent}
                  />
                  <Text style={selected ? styles.transportPillTextSelected : styles.transportPillText}>
                    {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[styles.calculateButton, !canCalculate && styles.calculateButtonDisabled]}
            onPress={handleCalculate}
            disabled={!canCalculate}
          >
            <Text style={styles.calculateButtonText}>Get recommendation</Text>
          </Pressable>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={20} color={COLORS.signalRisk} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.errorTitle}>Unable to calculate route</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Loading modal - premium animated recommendation screen */}
      <Modal visible={loading} animationType="fade">
        <LoadingRecommendation />
      </Modal>

      {/* Result modal - its own full-screen surface, not inline below the form */}
      <Modal visible={!!result} animationType="slide">
        {result && freshness && (
          <View style={styles.resultScreen}>
            <StatusBar style="light" />
            <View style={styles.resultHero}>
              <Pressable style={styles.resultBackButton} onPress={() => setResult(null)}>
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </Pressable>

              <View style={styles.tripStack}>
                <View style={styles.tripStackRow}>
                  <View style={[styles.tripDot, { backgroundColor: '#fff' }]} />
                  <Text style={styles.tripText} numberOfLines={2}>{originLabel}</Text>
                </View>
                <View style={styles.tripStackLine} />
                <View style={styles.tripStackRow}>
                  <Ionicons name="location" size={13} color={COLORS.signalRisk} />
                  <Text style={styles.tripText} numberOfLines={2}>{destLabel}</Text>
                </View>
              </View>

              {/* Only shown for arrive_by: the deadline is a distinct piece of
                  info from the computed leave time. For leave_at, the
                  departure time IS the hero's "Leave at" line already -
                  showing it again here would be redundant. */}
              {resultMode === 'arrive_by' && (
                <View style={styles.arrivalTargetRow}>
                  <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.7)" />
                  <Text style={styles.arrivalTargetText}>
                    Target arrival {selectedDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </Text>
                </View>
              )}

              <View style={styles.freshnessBadgeRow}>
                <View style={[styles.freshnessDot, { backgroundColor: freshness.color }]} />
                <Text style={styles.freshnessBadgeInline}>{freshness.text}</Text>
                <View style={styles.freshnessDivider} />
                {(() => { const w = weatherIndicator(result.weatherCondition); return (<><Ionicons name={w.icon as any} size={13} color={w.color} /><Text style={styles.freshnessBadgeInline}>{w.label}</Text></>); })()}
              </View>

              <View style={styles.heroLayout}>
                <View style={styles.heroTextCol}>
                  <Text style={styles.resultHeroLabel}>Leave at</Text>
                  <Text style={styles.resultHeroTime}>
                    {formatTime12h(result.recommendedLeaveTime)}
                  </Text>
                )}
                  <Text style={styles.resultArrivalInline}>
                    {resultMode === 'arrive_by' ? 'Arrive by ' : 'Est. arrival '}
                    {formatTime12h(result.predictedArrivalTime)}
                  </Text>
                </View>
                  <ConfidenceRing
                    progress={result.confidenceScore}
                    color={confidenceColor(result.confidenceScore)}
                    label={`${Math.round(result.confidenceScore)}%`}
                    sublabel={result.confidenceScore >= 85 ? "High" : result.confidenceScore >= 70 ? "Moderate" : "Low"}
                  />
            </View>
            </View>

            <ScrollView style={styles.resultBody}>
              {/* Mode-aware natural-language summary */}
              <Text style={styles.explanationSentence}>
                {resultMode === 'arrive_by'
                  ? `Leave at ${formatTime12h(result.recommendedLeaveTime)} to arrive by ${formatTime12h(result.predictedArrivalTime)}.`
                  : `If you leave at ${formatTime12h(result.recommendedLeaveTime)}, you'll arrive around ${formatTime12h(result.predictedArrivalTime)}.`}
              </Text>

              <Text style={styles.whyTitle}>Why this recommendation</Text>
              {result.confidenceReason.map((reason, i) => {
                const icon = reasonIcon(reason);
                return (
                  <View key={i} style={styles.reasonRow}>
                    <Ionicons name={icon.name as any} size={16} color={icon.color} style={{ marginTop: 1 }} />
                    <Text style={styles.reasonText}>{reason}</Text>
                  </View>
                );
              })}

              {!!result.recommendationExplanation?.factors?.length && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.whyTitle}>Estimated impact</Text>
                  {result.recommendationExplanation.factors.map((factor, i) => {
                    const icon = factorIcon(factor.type);
                    return (
                      <View key={i} style={styles.reasonRow}>
                        <Ionicons name={icon.name as any} size={16} color={icon.color} style={{ marginTop: 1 }} />
                        <Text style={styles.reasonText}>{factor.label}</Text>
                      </View>
                    );
                  })}
                </>
              )}

              <View style={styles.divider} />

              <Text style={styles.whyTitle}>Trip details</Text>
              <View style={styles.tripDetailRow}>
                <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.tripDetailLabel}>Travel time</Text>
                <Text style={styles.tripDetailValue}>
                  {formatTravelTime(result.recommendedLeaveTime, result.predictedArrivalTime)}
                </Text>
              </View>
              {formatDistance(result.distanceMeters) && (
                <View style={styles.tripDetailRow}>
                  <Ionicons name="navigate-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.tripDetailLabel}>Distance</Text>
                  <Text style={styles.tripDetailValue}>{formatDistance(result.distanceMeters)}</Text>
                </View>
              )}
              <View style={styles.tripDetailRow}>
                <Ionicons name="globe-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.tripDetailLabel}>Data source</Text>
                <Text style={styles.tripDetailValue}>Google Routes</Text>
              </View>
              <Text style={styles.updatedText}>Updated just now</Text>
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.canvas },
  fontLoadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.canvas },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, position: 'relative', overflow: 'hidden' },
  headerBgImage: {
    position: 'absolute',
    top: 58,
    right: -20,
    width: 160,
    height: 130,
  },
  headerLottie: { position: 'absolute', top: 60, right: 80, width: 65, height: 65, opacity: 0.65 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  logo: { width: 44, height: 44, borderRadius: 10 },
  logoText: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: COLORS.textPrimary },
  greeting: { fontFamily: 'Poppins_700Bold', fontSize: 21, color: COLORS.textPrimary },
  greetingSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },
  card: {
    flex: 1,
    backgroundColor: COLORS.card,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 24,
    padding: 20,
    shadowColor: COLORS.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: COLORS.canvas,
    borderRadius: 16,
    padding: 4,
    marginBottom: 16,
  },
  modeToggleButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  modeToggleButtonSelected: { backgroundColor: COLORS.ink },
  modeToggleText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textSecondary },
  modeToggleTextSelected: { color: '#fff' },
  scrollArea: { flex: 1 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.canvas,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  fieldDot: { width: 9, height: 9, borderRadius: 5 },
  fieldPinIcon: {},
  fieldTextCol: { flex: 1 },
  fieldLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: COLORS.accent, marginBottom: 2 },
  fieldValue: { fontFamily: 'Inter_500Medium', fontSize: 15, color: COLORS.textPrimary },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary, marginTop: 16, marginBottom: 8 },

  // Date & time - deliberately more visually prominent than other sections,
  // since this is the main focal point of the whole app.
  dateTimeSectionLabel: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
    color: COLORS.textPrimary,
    marginTop: 10,
    marginBottom: 6,
  },
  dateTimeCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.accentTint,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    marginBottom: 4,
    overflow: 'hidden',
  },
  dateTimeHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  dateTimeIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateTimeDividerVertical: { width: 1, backgroundColor: COLORS.accent, opacity: 0.25 },
  dateTimeSmallLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: COLORS.textSecondary },
  dateTimeBigValue: { fontFamily: 'Poppins_700Bold', fontSize: 17, color: COLORS.textPrimary, marginTop: 1 },

  warning: { fontFamily: 'Inter_400Regular', color: '#B4680A', fontSize: 13, marginTop: 6, marginBottom: 4 },
  transportRow: { flexDirection: 'row', gap: 8, marginBottom: 4, marginTop: 12 },
  transportPill: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.card,
  },
  transportPillSelected: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  transportPillText: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: COLORS.textPrimary, textAlign: 'center' },
  transportPillTextSelected: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: '#fff', textAlign: 'center' },
  calculateButton: {
    backgroundColor: COLORS.ink,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  calculateButtonDisabled: { backgroundColor: '#9B9DC2' },
  calculateButtonText: { fontFamily: 'Inter_600SemiBold', color: '#fff', fontSize: 16 },
  errorBox: {
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F4C6C0',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.signalRisk, marginBottom: 4 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary },

  // Result modal (its own full screen)
  resultScreen: { flex: 1, backgroundColor: COLORS.card },
  resultBackButton: {
    position: 'absolute',
    top: 54,
    left: 20,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultHero: {
    backgroundColor: COLORS.ink,
    paddingTop: 100,
    paddingBottom: 28,
    paddingHorizontal: 24,
  },
  tripStack: { marginBottom: 10 },
  tripStackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tripDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  tripStackLine: { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.3)', marginLeft: 2.5, marginVertical: 2 },
  tripText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.9)', flex: 1 },
  arrivalTargetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  arrivalTargetText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  tripDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  tripDetailLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, flex: 1 },
  tripDetailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary },
  updatedText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  freshnessBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 18,
  },
  freshnessDot: { width: 8, height: 8, borderRadius: 4 },
  freshnessDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.4)', marginHorizontal: 6 },
  freshnessBadgeInline: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#fff' },
  heroLayout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroTextCol: { flex: 1 },
  resultHeroLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  resultHeroTime: { fontFamily: 'Poppins_700Bold', fontSize: 40, color: '#fff', marginTop: 2 },
  resultArrivalInline: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  resultBody: { flex: 1, padding: 24 },
  explanationSentence: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 20,
    lineHeight: 20,
  },
  divider: { height: 1, backgroundColor: COLORS.divider, marginVertical: 16 },
  whyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: COLORS.textPrimary, marginBottom: 12 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 10 },
  reasonText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, flex: 1 },
});





































