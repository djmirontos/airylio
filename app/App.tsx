import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable, ActivityIndicator, ScrollView, Platform, Modal, TouchableWithoutFeedback, Keyboard, Alert } from 'react-native';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import DestinationAutocomplete from './components/DestinationAutocomplete';
import TimePickerModal from './components/TimePickerModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ConfidenceRing from './components/ConfidenceRing';
import LoadingRecommendation from './components/LoadingRecommendation';
import FeedbackModal from './components/FeedbackModal';
import PlanHeader from './components/PlanHeader';
import { supabase } from './lib/supabase';
import { useTripContext, PlanPrefill } from './context/TripContext';
import { useFavorites } from './hooks/useFavorites';
import { scheduleLeaveReminder, cancelLeaveReminder } from './hooks/useNotifications';
import * as Notifications from 'expo-notifications';
import { useTheme } from './context/ThemeContext';
import { MIN_LOADING_MS, LEAVE_AT_GRACE_MS, DEFAULT_TIME_OFFSET_MS, MAX_RECENT_DESTINATIONS, RECENT_DESTINATIONS_KEY, RECENT_ORIGINS_KEY } from './constants/config';
import { sanitizeError } from './utils/errors';
import { TripResult, ExplanationFactor } from './types/supabase';
import { calculateTrip } from './services/tripService';

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

function formatTime12h(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
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
  const [selectedTime, setSelectedTime] = useState<Date>(new Date(Date.now() + DEFAULT_TIME_OFFSET_MS));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [selectedMode, setSelectedMode] = useState('drive');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TripResult | null>(null);
  const [reminderSet, setReminderSet] = useState(false);
  const [feedbackTripId, setFeedbackTripId] = useState<string | null>(null);
  const [feedbackDestLabel, setFeedbackDestLabel] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerWeather, setHeaderWeather] = useState<'clear' | 'rain' | 'heavy_rain' | 'storm'>('clear');

  const { setCurrentTrip, prefillData, setPrefillData } = useTripContext();
  const { favorites } = useFavorites();
  const { colors: COLORS, isDark } = useTheme();
  const navigation = useNavigation();

  const confidenceColor = (score: number): string => {
    if (score >= 85) return COLORS.signalGood;
    if (score >= 70) return COLORS.signalWarn;
    return COLORS.signalRisk;
  };

  const freshnessLabel = (freshness: string): { text: string; color: string } => {
    if (freshness === 'live') return { text: 'Live traffic', color: COLORS.signalGood };
    if (freshness === 'cached') return { text: 'Recent data', color: COLORS.signalWarn };
    return { text: 'Estimated', color: COLORS.textSecondary };
  };

  const reasonIcon = (reason: string): { name: string; color: string } => {
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
  };

  const factorIcon = (type: 'weather' | 'rush_hour' | 'buffer_cap'): { name: string; color: string } => {
    if (type === 'weather') return { name: 'rainy', color: '#4A90D9' };
    if (type === 'rush_hour') return { name: 'car', color: COLORS.accent };
    return { name: 'time', color: COLORS.signalWarn }; // buffer_cap
  };

  const weatherIndicator = (condition?: 'clear' | 'rain' | 'heavy_rain' | 'storm'): { icon: string; label: string; color: string } => {
    if (condition === 'storm') return { icon: 'thunderstorm', label: 'Storm', color: '#7B5EA7' };
    if (condition === 'heavy_rain') return { icon: 'rainy', label: 'Heavy Rain', color: '#4A90D9' };
    if (condition === 'rain') return { icon: 'rainy-outline', label: 'Rain', color: '#4A90D9' };
    return { icon: 'sunny', label: 'Clear', color: COLORS.signalGood };
  };

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

  useEffect(() => {
    if (!prefillData) return;
    setOriginLabel(prefillData.originLabel);
    setOriginCoords({ lat: prefillData.originLat, lng: prefillData.originLng });
    setDestLabel(prefillData.destLabel);
    setDestCoords({ lat: prefillData.destLat, lng: prefillData.destLng });
    setPlanningMode(prefillData.planningMode);
    setOriginEditing(false);
    setTimeout(() => setShowTimePicker(true), 300);
    setPrefillData(null);
  }, [prefillData]);

  useEffect(() => {
    setReminderSet(false);
  }, [result]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.type === 'feedback' && data?.tripId) {
        setFeedbackTripId(data.tripId as string);
        setFeedbackDestLabel(destLabel);
        setShowFeedback(true);
      }
    });
    return () => subscription.remove();
  }, [destLabel]);

  function useCurrentLocation() {
    if (!gpsCoords) return;
    setOriginCoords(gpsCoords);
    setOriginLabel('Current Location');
    setOriginEditing(false);
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

  const showGpsChip = originLabel === 'Current Location' && !!originCoords && !originEditing;
  const showManualChip = originLabel !== 'Current Location' && !!originCoords && !originEditing;

  const selectedDateTime = combineDateAndTime(selectedDate, selectedTime);
  const isValidDepartureTime = selectedDateTime.getTime() >= Date.now() - LEAVE_AT_GRACE_MS;
  const canCalculate = !!originCoords && !!destCoords && isValidDepartureTime && !loading;

  async function handleCalculate() {
    if (!originCoords || !destCoords) return;

    setLoading(true);
    setError(null);
    setResult(null);
    const loadingStartedAt = Date.now();

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

  const freshness = result ? freshnessLabel(result.dataFreshness) : null;
  // Read the mode from the result itself (echoed back by the engine), not the
  // live toggle state - the toggle can't actually change while the result
  // modal is open, but this is the more correct source of truth regardless.
  const resultMode: PlanningMode = result?.recommendationExplanation?.planningMode ?? planningMode;

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.canvas },
    fontLoadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.canvas },
    card: { flex: 1, backgroundColor: COLORS.card, marginHorizontal: 16, marginBottom: 16, borderRadius: 24, padding: 20, shadowColor: COLORS.ink, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 4 },
    modeToggleRow: { flexDirection: 'row', gap: 6, backgroundColor: COLORS.accentTint, borderRadius: 16, padding: 4, marginBottom: 16 },
    modeToggleButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
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
    sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary, marginTop: 16, marginBottom: 8 },
    dateTimeSectionLabel: { fontFamily: 'Poppins_700Bold', fontSize: 15, color: COLORS.textPrimary, marginTop: 10, marginBottom: 6 },
    dateTimeCard: { flexDirection: 'row', backgroundColor: COLORS.accentTint, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.accent, marginBottom: 4, overflow: 'hidden' },
    dateTimeHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
    dateTimeIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
    dateTimeDividerVertical: { width: 1, backgroundColor: COLORS.accent, opacity: 0.25 },
    dateTimeSmallLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: COLORS.textSecondary },
    dateTimeBigValue: { fontFamily: 'Poppins_700Bold', fontSize: 17, color: COLORS.textPrimary, marginTop: 1 },
    warning: { fontFamily: 'Inter_400Regular', color: '#B4680A', fontSize: 13, marginTop: 6, marginBottom: 4 },
    transportRow: { flexDirection: 'row', gap: 8, marginBottom: 4, marginTop: 12 },
    transportPill: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.divider, backgroundColor: COLORS.card },
    transportPillSelected: { backgroundColor: COLORS.accent, borderColor: COLORS.accent, borderWidth: 1 },
    transportPillText: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: COLORS.textPrimary, textAlign: 'center' },
    transportPillTextSelected: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: '#fff', textAlign: 'center' },
    favoritesRow: { flexDirection: 'row', gap: 8, marginBottom: 8, marginTop: 4, paddingHorizontal: 4 },
    favoriteChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: COLORS.accentTint, borderWidth: 1, borderColor: 'rgba(76,79,158,0.2)' },
    favoriteChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: COLORS.accent },
    calculateButton: { backgroundColor: COLORS.accent, paddingVertical: 16, borderRadius: 16, alignItems: 'center', marginTop: 12 },
    calculateButtonDisabled: { backgroundColor: '#9B9DC2' },
    calculateButtonText: { fontFamily: 'Inter_600SemiBold', color: '#fff', fontSize: 16 },
    errorBox: { marginTop: 20, padding: 16, borderRadius: 16, backgroundColor: '#FDECEA', borderWidth: 1, borderColor: '#F4C6C0', flexDirection: 'row', alignItems: 'flex-start' },
    errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.signalRisk, marginBottom: 4 },
    errorText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary },
    resultScreen: { flex: 1, backgroundColor: COLORS.card },
    resultBackButton: { position: 'absolute', top: 32, left: 20, zIndex: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    resultHero: { backgroundColor: '#0D1021', paddingTop: 70, paddingBottom: 16, paddingHorizontal: 20 },
    tripStack: { marginBottom: 6 },
    tripStackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    tripDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
    tripStackLine: { width: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.3)', marginLeft: 2.5, marginVertical: 2 },
    tripText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.95)', flex: 1 },
    arrivalTargetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    arrivalTargetText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.85)' },
    tripDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
    tripDetailLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, flex: 1 },
    tripDetailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary },
    viewRouteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.signalGood, paddingVertical: 14, borderRadius: 16, marginTop: 8, marginBottom: 4 },
    viewRouteButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
    updatedText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
    freshnessBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 10 },
    freshnessDot: { width: 8, height: 8, borderRadius: 4 },
    freshnessDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.4)', marginHorizontal: 6 },
    freshnessBadgeInline: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#fff' },
    heroLayout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heroTextCol: { flex: 1 },
    resultHeroLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.85)' },
    resultHeroTime: { fontFamily: 'Poppins_700Bold', fontSize: 34, color: '#fff', marginTop: 2 },
    resultArrivalInline: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 3 },
    resultBody: { flex: 1, padding: 16 },
    explanationSentence: { fontFamily: 'Inter_500Medium', fontSize: 14, color: COLORS.textPrimary, marginBottom: 12, lineHeight: 20 },
    divider: { height: 1, backgroundColor: COLORS.divider, marginVertical: 10 },
    whyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: COLORS.textPrimary, marginBottom: 8 },
    reasonRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 10 },
    reasonText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, flex: 1 },
    remindButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.accent, marginTop: 8, marginBottom: 4 },
    remindButtonActive: { borderColor: COLORS.signalGood, backgroundColor: 'rgba(18,184,134,0.08)' },
    remindButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.accent },
    remindButtonTextActive: { color: COLORS.signalGood },
  }), [COLORS]);

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <View style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <PlanHeader greeting={getGreeting()} headerWeather={headerWeather} isDark={isDark} colors={COLORS} />

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
                favorites={favorites}
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
                favorites={favorites}
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
              {(() => {
                const cleanReason = (r: string) => r.replace('heavy_rain', 'Heavy Rain').replace('_rain', ' Rain');
                return result.confidenceReason.map((reason, i) => {
                  const icon = reasonIcon(reason);
                  return (
                    <View key={i} style={styles.reasonRow}>
                      <Ionicons name={icon.name as any} size={16} color={icon.color} style={{ marginTop: 1 }} />
                      <Text style={styles.reasonText}>{cleanReason(reason)}</Text>
                    </View>
                  );
                });
              })()}

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
              {result?.encodedPolyline && (
                <Pressable style={styles.viewRouteButton} onPress={() => { setResult(null); navigation.navigate('Map'); }}>
                  <Ionicons name="map" size={16} color="#fff" />
                  <Text style={styles.viewRouteButtonText}>View Route on Map</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.remindButton, reminderSet && styles.remindButtonActive]}
                onPress={reminderSet ? undefined : handleSetReminder}
              >
                <Ionicons name={reminderSet ? 'checkmark-circle' : 'notifications-outline'} size={16} color={reminderSet ? COLORS.signalGood : COLORS.accent} />
                <Text style={[styles.remindButtonText, reminderSet && styles.remindButtonTextActive]}>
                  {reminderSet ? 'Reminder set' : 'Remind me when it\'s time to leave'}
                </Text>
              </Pressable>
              <Text style={styles.updatedText}>Updated just now</Text>
            </ScrollView>
          </View>
        )}
      </Modal>
      <FeedbackModal
        visible={showFeedback}
        tripId={feedbackTripId}
        destLabel={feedbackDestLabel}
        onClose={() => setShowFeedback(false)}
      />
    </View>
    </TouchableWithoutFeedback>
  );
}

