import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable, ScrollView, Platform, Modal, Alert, Keyboard } from 'react-native';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import TimePickerModal from './components/TimePickerModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import LoadingRecommendation from './components/LoadingRecommendation';
import ResultModal from './components/ResultModal';
import PlanHeader from './components/PlanHeader';
import { supabase } from './lib/supabase';
import { useTripContext, PlanPrefill } from './context/TripContext';
import { scheduleLeaveReminder, cancelLeaveReminder } from './hooks/useNotifications';
import { useTheme } from './context/ThemeContext';
import { MIN_LOADING_MS, LEAVE_AT_GRACE_MS, DEFAULT_TIME_OFFSET_MS, MAX_RECENT_DESTINATIONS, RECENT_DESTINATIONS_KEY, RECENT_ORIGINS_KEY, WEATHER_FETCH_TIMEOUT_MS } from './constants/config';
import { sanitizeError } from './utils/errors';
import { TripResult } from './types/supabase';
import { calculateTrip, submitFeedback } from './services/tripService';
import { useYesterdayTrip } from './hooks/useYesterdayTrip';
import YesterdayTripBanner from './components/YesterdayTripBanner';
import { captureEvent } from './lib/posthog';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY!;


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

interface Coords {
  lat: number;
  lng: number;
}

interface RecentDestination {
  label: string;
  lat: number;
  lng: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function combineDateAndTime(date: Date, time: Date): Date {
  const combined = new Date(date);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}

export default function App() {
  const [gpsCoords, setGpsCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [originCoords, setOriginCoords] = useState<Coords | null>(null);
  const [originLabel, setOriginLabel] = useState('Current Location');
  const originPickedRef = useRef(false);

  const [destCoords, setDestCoords] = useState<Coords | null>(null);
  const [destLabel, setDestLabel] = useState('');
  const [recentDestinations, setRecentDestinations] = useState<RecentDestination[]>([]);
  const [recentOrigins, setRecentOrigins] = useState<RecentDestination[]>([]);

  const [planningMode, setPlanningMode] = useState<PlanningMode>('arrive_by');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [selectedTime, setSelectedTime] = useState<Date>(new Date(Date.now() + DEFAULT_TIME_OFFSET_MS));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [selectedMode, setSelectedMode] = useState('drive');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TripResult | null>(null);
  const [reminderSet, setReminderSet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerWeather, setHeaderWeather] = useState<'clear' | 'rain' | 'heavy_rain' | 'storm'>('clear');

  const { yesterdayTrip, loaded: yesterdayLoaded } = useYesterdayTrip();
  const [yesterdayDismissed, setYesterdayDismissed] = useState(false);
  const { setCurrentTrip, prefillData, setPrefillData } = useTripContext();
  const { colors: COLORS, isDark } = useTheme();
  const navigation = useNavigation<any>();

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
        // Don't stomp an origin the user picked while the GPS lookup was in flight.
        if (!originPickedRef.current) {
          setOriginCoords(coords);
          setOriginLabel('Current Location');
        }
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
      } catch (err: any) {
        // Non-critical, but logged: a systematically failing store was invisible.
        console.warn('[Plan] Failed to load recent destinations:', err?.message ?? err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENT_ORIGINS_KEY);
        if (stored) setRecentOrigins(JSON.parse(stored));
      } catch (err: any) {
        console.warn('[Plan] Failed to load recent origins:', err?.message ?? err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!gpsCoords) return;
    // Bounded so a hanging Open-Meteo request cannot leave the header weather
    // pending indefinitely. WEATHER_FETCH_TIMEOUT_MS already existed but was
    // never wired up.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);
    (async () => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${gpsCoords.lat}&longitude=${gpsCoords.lng}&current=weathercode&timezone=auto`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          const code = data?.current?.weathercode ?? -1;
          if (code >= 96) setHeaderWeather('storm');
          else if (code >= 95) setHeaderWeather('heavy_rain');
          else if (code >= 80 || (code >= 51 && code <= 67)) setHeaderWeather('rain');
          else setHeaderWeather('clear');
        }
      } catch (err: any) {
        // Non-critical: the header just keeps its current icon.
        if (err?.name !== 'AbortError') {
          console.warn('[Plan] Header weather lookup failed:', err?.message ?? err);
        }
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
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

  useEffect(() => {
    if (!prefillData) return;
    originPickedRef.current = true;
    setOriginLabel(prefillData.originLabel);
    setOriginCoords({ lat: prefillData.originLat, lng: prefillData.originLng });
    setDestLabel(prefillData.destLabel);
    setDestCoords({ lat: prefillData.destLat, lng: prefillData.destLng });
    setPlanningMode(prefillData.planningMode);
    const timer = setTimeout(() => setShowTimePicker(true), 300);
    setPrefillData(null);
    return () => clearTimeout(timer);
  }, [prefillData]);

  useEffect(() => {
    setReminderSet(false);
  }, [result]);

  const route = useRoute();

  useEffect(() => {
    const params = route.params as { selectedPlace?: Coords & { label: string }; type?: string } | undefined;
    if (!params?.selectedPlace || !params?.type) return;

    const { label, lat, lng } = params.selectedPlace;
    if (params.type === 'origin') {
      originPickedRef.current = true;
      setOriginLabel(label);
      setOriginCoords({ lat, lng });
      addRecentOrigin(params.selectedPlace);
    } else if (params.type === 'destination') {
      setDestLabel(label);
      setDestCoords({ lat, lng });
      addRecentDestination(params.selectedPlace);
    }

    navigation.setParams({ selectedPlace: undefined, type: undefined });
  }, [route.params]);

  // The feedback notification is handled in AppNavigator, which sits inside
  // TripProvider and stays mounted whichever tab is open. Handling it here as
  // well opened two modals on one tap, and used whatever destination happened
  // to be typed rather than the one the trip was for.

  function useCurrentLocation() {
    if (!gpsCoords) return;
    originPickedRef.current = false;
    setOriginCoords(gpsCoords);
    setOriginLabel('Current Location');
  }

  async function handleYesterdayRate(rating: 'accurate' | 'close' | 'late') {
    if (!yesterdayTrip) return;
    try {
      await submitFeedback(yesterdayTrip.tripId, rating);
      captureEvent('feedback_submitted', { rating, source: 'yesterday_banner' });
    } catch {
      // Silent - banner dismisses regardless
    } finally {
      setYesterdayDismissed(true);
    }
  }

  async function handleSetReminder() {
    if (!result) return;
    const id = await scheduleLeaveReminder(
      result.recommendedLeaveTime,
      result.predictedArrivalTime,
      destLabel,
      result.tripId
    );
    if (id) {
      setReminderSet(true);
    } else {
      Alert.alert('Permission Required', 'Please enable notifications in your device settings to use this feature.');
    }
  }

  const selectedDateTime = combineDateAndTime(selectedDate, selectedTime);
  const isValidDepartureTime = selectedDateTime.getTime() >= Date.now() - LEAVE_AT_GRACE_MS;
  const canCalculate = !!originCoords && !!destCoords && isValidDepartureTime && !loading;

  async function handleCalculate() {
    if (!originCoords || !destCoords) return;

    setLoading(true);
    setError(null);
    setResult(null);
    const loadingStartedAt = Date.now();

    captureEvent('calculation_triggered', {
      planning_mode: planningMode,
      transport_mode: selectedMode,
    });

    try {
      const data = await calculateTrip({
        originLat: originCoords.lat,
        originLng: originCoords.lng,
        destLat: destCoords.lat,
        destLng: destCoords.lng,
        planningMode,
        targetTime: selectedDateTime.toISOString(),
        transportMode: selectedMode,
        originLabel,
        destinationLabel: destLabel,
      });

      setResult(data);
      setCurrentTrip(data, {
        originLabel,
        destLabel,
        originLat: originCoords.lat,
        originLng: originCoords.lng,
        destLat: destCoords.lat,
        destLng: destCoords.lng,
        selectedDateTime,
        planningMode,
      });
    } catch (err: any) {
      setError(sanitizeError(err.message ?? 'Something went wrong'));
    } finally {
      const elapsed = Date.now() - loadingStartedAt;
      const remaining = MIN_LOADING_MS - elapsed;
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      setLoading(false);
    }
  }

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.canvas },
    card: { flex: 1, backgroundColor: COLORS.card, marginHorizontal: 16, marginBottom: 16, borderRadius: 24, padding: 20, shadowColor: COLORS.ink, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 4 },
    modeToggleRow: { flexDirection: 'row', gap: 6, backgroundColor: COLORS.accentTint, borderRadius: 16, padding: 4, marginBottom: 16 },
    modeToggleButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, minHeight: 44, minWidth: 44 },
    modeToggleButtonSelected: { backgroundColor: COLORS.accent },
    modeToggleText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textSecondary },
    modeToggleTextSelected: { color: '#fff' },
    scrollArea: { flex: 1 },
    fieldRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.canvas, borderRadius: 14, padding: 14, marginBottom: 10, gap: 12 },
    fieldDot: { width: 9, height: 9, borderRadius: 5 },
    fieldPinIcon: {},
    fieldTextCol: { flex: 1 },
    fieldLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: COLORS.accent, marginBottom: 2 },
    fieldValue: { fontFamily: 'Inter_500Medium', fontSize: 15, color: COLORS.textPrimary },
    dateTimeSectionLabel: { fontFamily: 'Poppins_700Bold', fontSize: 15, color: COLORS.textPrimary, marginTop: 10, marginBottom: 6 },
    dateTimeCard: { flexDirection: 'row', backgroundColor: COLORS.accentTint, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.accent, marginBottom: 4 },
    dateTimeHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
    dateTimeIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
    dateTimeDividerVertical: { width: 1, backgroundColor: COLORS.accent, opacity: 0.25 },
    dateTimeSmallLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: COLORS.textSecondary },
    dateTimeBigValue: { fontFamily: 'Poppins_700Bold', fontSize: 17, color: COLORS.textPrimary, marginTop: 1 },
    warning: { fontFamily: 'Inter_400Regular', color: '#B4680A', fontSize: 13, marginTop: 6, marginBottom: 4 },
    transportRow: { flexDirection: 'row', gap: 8, marginBottom: 4, marginTop: 12 },
    transportPill: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.divider, backgroundColor: COLORS.card, minHeight: 44, minWidth: 44 },
    transportPillSelected: { backgroundColor: COLORS.accent, borderColor: COLORS.accent, borderWidth: 1 },
    transportPillText: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: COLORS.textPrimary, textAlign: 'center' },
    transportPillTextSelected: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: '#fff', textAlign: 'center' },
    calculateButton: { backgroundColor: COLORS.accent, paddingVertical: 16, borderRadius: 16, alignItems: 'center', marginTop: 12, minHeight: 44 },
    calculateButtonDisabled: { backgroundColor: '#9B9DC2' },
    calculateButtonText: { fontFamily: 'Inter_600SemiBold', color: '#fff', fontSize: 16 },
    // Tinted from signalRisk rather than a fixed pale pink: the hardcoded
    // #FDECEA stayed light in dark mode, leaving light-grey body text on a
    // near-white panel - unreadable on exactly the screen that reports a
    // problem.
    errorBox: {
      marginTop: 20,
      padding: 16,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(232,93,81,0.14)' : '#FDECEA',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(232,93,81,0.4)' : '#F4C6C0',
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.signalRisk, marginBottom: 4 },
    errorText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: isDark ? COLORS.textPrimary : COLORS.textSecondary },
  }), [COLORS, isDark]);

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <PlanHeader greeting={getGreeting()} headerWeather={headerWeather} isDark={isDark} colors={COLORS} />

      <View style={styles.card}>
        {/* Planning mode toggle - first-class, not a subtle segmented control */}
        <View style={styles.modeToggleRow}>
          <Pressable
            style={[styles.modeToggleButton, planningMode === 'arrive_by' && styles.modeToggleButtonSelected]}
            onPress={() => setPlanningMode('arrive_by')}
            accessibilityLabel="Arrive By mode"
            accessibilityRole="button"
          >
            <Ionicons name="flag" size={15} color={planningMode === 'arrive_by' ? '#fff' : COLORS.textSecondary} />
            <Text style={[styles.modeToggleText, planningMode === 'arrive_by' && styles.modeToggleTextSelected]}>
              Arrive By
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeToggleButton, planningMode === 'leave_at' && styles.modeToggleButtonSelected]}
            onPress={() => setPlanningMode('leave_at')}
            accessibilityLabel="Leave At mode"
            accessibilityRole="button"
          >
            <Ionicons name="rocket" size={15} color={planningMode === 'leave_at' ? '#fff' : COLORS.textSecondary} />
            <Text style={[styles.modeToggleText, planningMode === 'leave_at' && styles.modeToggleTextSelected]}>
              Leave At
            </Text>
          </Pressable>
        </View>

        {/* From */}
        <View style={{ position: 'relative' }}>
          <Pressable
            style={styles.fieldRow}
            onPress={() =>
              navigation.navigate('Search', {
                type: 'origin',
                returnTo: 'PlanMain',
                apiKey: GOOGLE_PLACES_API_KEY,
                placeholder: 'Search origin',
              })
            }
          >
            <View style={[styles.fieldDot, { backgroundColor: COLORS.accent }]} />
            <View style={styles.fieldTextCol}>
              <Text style={styles.fieldLabel}>From</Text>
              <Text
                style={[styles.fieldValue, !originLabel && { color: COLORS.textSecondary }]}
                numberOfLines={1}
              >
                {originLabel || locationError || 'Search origin'}
              </Text>
            </View>
            {gpsCoords && originLabel !== 'Current Location' && (
              <Pressable hitSlop={8} onPress={useCurrentLocation}>
                <Ionicons name="locate-outline" size={18} color={COLORS.textSecondary} />
              </Pressable>
            )}
            {originLabel === 'Current Location' && (
              <Ionicons name="locate" size={18} color={COLORS.accent} />
            )}
          </Pressable>
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
          <Pressable
            style={styles.fieldRow}
            onPress={() => {
              navigation.navigate('Search', {
                type: 'destination',
                returnTo: 'PlanMain',
                apiKey: GOOGLE_PLACES_API_KEY,
                placeholder: 'Search destination',
              });
            }}
          >
            <Ionicons name="location" size={16} color={COLORS.signalRisk} style={styles.fieldPinIcon} />
            <View style={styles.fieldTextCol}>
              <Text style={styles.fieldLabel}>To</Text>
              <Text style={[styles.fieldValue, { color: COLORS.textSecondary }]}>
                Search destination
              </Text>
            </View>
          </Pressable>
        )}
        </View>
        <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss}>
          {yesterdayLoaded && yesterdayTrip && !yesterdayDismissed && (
            <YesterdayTripBanner
              trip={yesterdayTrip}
              onRate={handleYesterdayRate}
              onDismiss={() => setYesterdayDismissed(true)}
            />
          )}

          {/* Date & time - the main focal point, styled prominently */}
          <Text style={styles.dateTimeSectionLabel}>
            {planningMode === 'arrive_by' ? 'Arrival date & time' : 'Departure date & time'}
          </Text>
          <View style={styles.dateTimeCard}>
            <Pressable style={styles.dateTimeHalf} onPress={() => setShowDatePicker(true)} accessibilityLabel="Select date" accessibilityRole="button">
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
            <Pressable style={styles.dateTimeHalf} onPress={() => setShowTimePicker(true)} accessibilityLabel="Select time" accessibilityRole="button">
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
                  accessibilityLabel={`${mode.label} transport mode`}
                  accessibilityRole="button"
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
            accessibilityLabel="Get recommendation"
            accessibilityRole="button"
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

      {/* Single source of truth for the result UI, shared with History. */}
      <ResultModal
        result={result}
        originLabel={originLabel}
        destLabel={destLabel}
        selectedDateTime={selectedDateTime}
        planningMode={planningMode}
        onClose={() => setResult(null)}
        onViewRoute={() => { setResult(null); navigation.navigate('Map'); }}
        onSetReminder={handleSetReminder}
        reminderSet={reminderSet}
      />
    </View>
  );
}

