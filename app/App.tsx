import { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable, ActivityIndicator, ScrollView, Platform, Modal, TouchableWithoutFeedback, Keyboard } from 'react-native';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import GooglePlacesTextInput from 'react-native-google-places-textinput';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ConfidenceRing from './components/ConfidenceRing';
import { supabase } from './lib/supabase';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY!;

const COLORS = {
  ink: '#12153D',
  accent: '#4C4F9E',
  signalGood: '#12B886',
  signalWarn: '#F5A623',
  signalRisk: '#E85D51',
  canvas: '#FAFAFC',
  card: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B6F8A',
  divider: '#E7E7F1',
};

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

// Honest staged status text - matches what calculate-trip's Edge Function
// actually does (cache check, Google Routes call, engine calculation),
// not invented marketing steps.
const LOADING_STEPS = [
  'Checking recent routes...',
  'Fetching live traffic...',
  'Calculating your recommendation...',
];

interface TripResult {
  tripId: string;
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  dataFreshness: string;
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
const MAX_RECENT_DESTINATIONS = 8;

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

function confidenceColor(score: number): string {
  if (score >= 85) return COLORS.signalGood;
  if (score >= 70) return COLORS.signalWarn;
  return COLORS.signalRisk;
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_600SemiBold,
    Poppins_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const [gpsCoords, setGpsCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [originCoords, setOriginCoords] = useState<Coords | null>(null);
  const [originLabel, setOriginLabel] = useState('Current Location');
  const originRef = useRef<any>(null);

  const [destCoords, setDestCoords] = useState<Coords | null>(null);
  const [destLabel, setDestLabel] = useState('');
  const [destFocused, setDestFocused] = useState(false);
  const destBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentDestinations, setRecentDestinations] = useState<RecentDestination[]>([]);

  const [arrivalDate, setArrivalDate] = useState<Date>(startOfToday());
  const [arrivalTime, setArrivalTime] = useState<Date>(new Date(Date.now() + 60 * 60 * 1000));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [selectedMode, setSelectedMode] = useState('drive');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [result, setResult] = useState<TripResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

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

  function useCurrentLocation() {
    if (!gpsCoords) return;
    setOriginCoords(gpsCoords);
    setOriginLabel('Current Location');
    originRef.current?.clear();
  }

  function handleDestFocus() {
    if (destBlurTimeout.current) clearTimeout(destBlurTimeout.current);
    setDestFocused(true);
  }

  function handleDestBlur() {
    // Delay hiding so a tap on a recent-item row registers before the list disappears.
    destBlurTimeout.current = setTimeout(() => setDestFocused(false), 150);
  }

  function selectRecentDestination(item: RecentDestination) {
    if (destBlurTimeout.current) clearTimeout(destBlurTimeout.current);
    setDestCoords({ lat: item.lat, lng: item.lng });
    setDestLabel(item.label);
    setDestFocused(false);
  }

  const showGpsChip = originLabel === 'Current Location' && !!originCoords;

  const arrivalDateTime = combineDateAndTime(arrivalDate, arrivalTime);
  const isArrivalInFuture = arrivalDateTime.getTime() > Date.now();
  const canCalculate = !!originCoords && !!destCoords && isArrivalInFuture && !loading;

  async function handleCalculate() {
    if (!originCoords || !destCoords) return;

    setLoading(true);
    setLoadingStep(0);
    setError(null);
    setResult(null);
    setFeedbackSubmitted(false);

    loadingInterval.current = setInterval(() => {
      setLoadingStep((prev) => Math.min(prev + 1, LOADING_STEPS.length - 1));
    }, 700);

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
          arrivalTarget: arrivalDateTime.toISOString(),
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
      if (loadingInterval.current) clearInterval(loadingInterval.current);
      setLoading(false);
    }
  }

  async function submitFeedback(rating: 'accurate' | 'close' | 'late') {
    if (!result || feedbackSubmitted || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    try {
      const userSuccess = rating !== 'late';
      const { error: feedbackError } = await supabase.from('feedback').insert({
        trip_id: result.tripId,
        rating,
        user_success: userSuccess,
      });
      if (feedbackError) throw feedbackError;
      setFeedbackSubmitted(true);
    } catch {
      // Non-critical path: fail silently, user can simply not see confirmation.
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  if (!fontsLoaded) {
    return (
      <View style={styles.fontLoadingContainer}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const freshness = result ? freshnessLabel(result.dataFreshness) : null;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.wordmark}>Airylio</Text>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.greetingSub}>Where are you headed?</Text>
      </View>

      <View style={styles.card}>
        {/* From */}
        <View style={styles.fieldRow}>
          <View style={[styles.fieldDot, { backgroundColor: COLORS.accent }]} />
          <View style={styles.fieldTextCol}>
            <Text style={styles.fieldLabel}>From</Text>
            {showGpsChip && (
              <Pressable onPress={() => originRef.current?.focus()}>
                <Text style={styles.fieldValue}>Your current location</Text>
              </Pressable>
            )}
            <GooglePlacesTextInput
              ref={originRef}
              apiKey={GOOGLE_PLACES_API_KEY}
              placeHolderText={locationError ?? 'Search origin'}
              fetchDetails
              detailsFields={['location', 'formattedAddress']}
              includedRegionCodes={['ph']}
              minCharsToFetch={2}
              debounceDelay={300}
              onPlaceSelect={(place: any) => {
                setOriginLabel(place.details?.formattedAddress ?? 'Selected location');
                if (place.details?.location) {
                  setOriginCoords({
                    lat: place.details.location.latitude,
                    lng: place.details.location.longitude,
                  });
                }
              }}
              style={{
                container: { marginTop: 2, display: showGpsChip ? 'none' : 'flex', borderWidth: 0, backgroundColor: 'transparent', position: 'relative' },
                inputContainer: { borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
                input: styles.inlineInput,
                suggestionsContainer: [
                  styles.premiumDropdown,
                  {
                    left: -35,
                    right: gpsCoords && !showGpsChip ? -44 : -14,
                  },
                ],
                suggestionItem: styles.premiumDropdownItem,
                suggestionText: {
                  main: styles.premiumDropdownMain,
                  secondary: styles.premiumDropdownSecondary,
                },
                loadingIndicator: { color: COLORS.accent },
                placeholder: { color: COLORS.textSecondary },
              }}
            />
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
              <GooglePlacesTextInput
                apiKey={GOOGLE_PLACES_API_KEY}
                placeHolderText="Search destination"
                fetchDetails
                detailsFields={['location', 'formattedAddress']}
                includedRegionCodes={['ph']}
                minCharsToFetch={2}
                debounceDelay={300}
                onFocus={handleDestFocus}
                onBlur={handleDestBlur}
                onPlaceSelect={(place: any) => {
                  if (place.details?.location) {
                    const coords = {
                      lat: place.details.location.latitude,
                      lng: place.details.location.longitude,
                    };
                    const label = place.details.formattedAddress ?? 'Selected location';
                    setDestCoords(coords);
                    setDestLabel(label);
                    setDestFocused(false);
                    addRecentDestination({ label, lat: coords.lat, lng: coords.lng });
                  }
                }}
                style={{
                  container: { marginTop: 2, borderWidth: 0, backgroundColor: 'transparent', position: 'relative' },
                  inputContainer: { borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
                  input: styles.inlineInput,
                  suggestionsContainer: styles.premiumDropdown,
                  suggestionItem: styles.premiumDropdownItem,
                  suggestionText: {
                    main: styles.premiumDropdownMain,
                    secondary: styles.premiumDropdownSecondary,
                  },
                  loadingIndicator: { color: COLORS.accent },
                  placeholder: { color: COLORS.textSecondary },
                }}
              />
            </View>
          </View>
        )}

        {destFocused && !destLabel && recentDestinations.length > 0 && (
          <View style={styles.recentListFloating}>
            <Text style={styles.recentLabel}>Recent</Text>
            <ScrollView
              style={styles.recentScroll}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={recentDestinations.length > 3}
            >
              {recentDestinations.map((item) => (
                <Pressable
                  key={item.label}
                  style={styles.recentItem}
                  onPress={() => selectRecentDestination(item)}
                >
                  <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.recentItemText} numberOfLines={2} ellipsizeMode="tail">
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        </View>

        <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>Arrive by</Text>
          <View style={styles.arrivalRow}>
            <Pressable style={styles.arrivalHalf} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.arrivalText}>
                {arrivalDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </Text>
            </Pressable>
            <View style={styles.arrivalDivider} />
            <Pressable style={styles.arrivalHalf} onPress={() => setShowTimePicker(true)}>
              <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.arrivalText}>
                {arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </Pressable>
          </View>
          {!isArrivalInFuture && (
            <Text style={styles.warning}>Arrival time must be in the future.</Text>
          )}

          {showDatePicker && (
            <DateTimePicker
              value={arrivalDate}
              mode="date"
              minimumDate={startOfToday()}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selected) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (selected) setArrivalDate(selected);
              }}
            />
          )}
          {showTimePicker && (
            <DateTimePicker
              value={arrivalTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selected) => {
                setShowTimePicker(Platform.OS === 'ios');
                if (selected) setArrivalTime(selected);
              }}
            />
          )}

          <Text style={styles.sectionLabel}>Travel mode</Text>
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

      {/* Loading modal - staged status text matching the real pipeline steps */}
      <Modal visible={loading} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={COLORS.accent} />
            <Text style={styles.loadingStepText}>{LOADING_STEPS[loadingStep]}</Text>
            <View style={styles.loadingDotsRow}>
              {LOADING_STEPS.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.loadingDot,
                    i <= loadingStep && styles.loadingDotActive,
                  ]}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Result modal - its own full-screen surface, not inline below the form */}
      <Modal visible={!!result} animationType="slide">
        {result && freshness && (
          <View style={styles.resultScreen}>
            <StatusBar style="light" />
            <View style={styles.resultHero}>
              <Pressable style={styles.resultCloseButton} onPress={() => setResult(null)}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>

              <View style={styles.freshnessBadgeRow}>
                <View style={[styles.freshnessDot, { backgroundColor: freshness.color }]} />
                <Text style={styles.freshnessBadgeInline}>{freshness.text}</Text>
              </View>

              <View style={styles.heroLayout}>
                <View style={styles.heroTextCol}>
                  <Text style={styles.resultHeroLabel}>Leave by</Text>
                  <Text style={styles.resultHeroTime}>
                    {new Date(result.recommendedLeaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <Text style={styles.resultArrivalInline}>
                    Arrive ~{new Date(result.predictedArrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <ConfidenceRing
                  progress={result.confidenceScore}
                  color={confidenceColor(result.confidenceScore)}
                  label={`${Math.round(result.confidenceScore)}%`}
                />
              </View>
            </View>

            <ScrollView style={styles.resultBody}>
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

              <View style={styles.divider} />

              <Text style={styles.feedbackPrompt}>How did it go?</Text>
              {feedbackSubmitted ? (
                <View style={styles.feedbackThanksRow}>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.signalGood} />
                  <Text style={styles.feedbackThanks}>Thanks for your feedback!</Text>
                </View>
              ) : (
                <View style={styles.feedbackRow}>
                  <Pressable
                    style={styles.feedbackButton}
                    onPress={() => submitFeedback('accurate')}
                    disabled={feedbackSubmitting}
                  >
                    <Text style={styles.feedbackButtonText}>👍 On Time</Text>
                  </Pressable>
                  <Pressable
                    style={styles.feedbackButton}
                    onPress={() => submitFeedback('close')}
                    disabled={feedbackSubmitting}
                  >
                    <Text style={styles.feedbackButtonText}>👌 Close</Text>
                  </Pressable>
                  <Pressable
                    style={styles.feedbackButton}
                    onPress={() => submitFeedback('late')}
                    disabled={feedbackSubmitting}
                  >
                    <Text style={styles.feedbackButtonText}>👎 Late</Text>
                  </Pressable>
                </View>
              )}
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
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16 },
  wordmark: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.accent, letterSpacing: 0.5, marginBottom: 14 },
  greeting: { fontFamily: 'Poppins_700Bold', fontSize: 26, color: COLORS.textPrimary },
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
  inlineInput: {
    height: 22,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: COLORS.textPrimary,
    padding: 0,
    margin: 0,
    borderWidth: 0,
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  recentList: { paddingVertical: 6 },
  recentListFloating: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 8,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    zIndex: 50,
    elevation: 8,
    shadowColor: COLORS.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
  },
  recentScroll: { maxHeight: 150 },
  premiumDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 8,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    zIndex: 50,
    elevation: 8,
    shadowColor: COLORS.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    maxHeight: 260,
  },
  // From's inner text column is narrower than To's (it has both a leading
  // dot icon and a trailing locate icon reducing its flex width, while To's
  // search-mode row only has the leading pin icon). Offset accounts for:
  // fieldRow's own 14px padding + dot(9)+gap(12) on the left = 35,
  // fieldRow's own 14px padding + gap(12)+icon(18) on the right = 44.
  // Offset is now computed inline (state-dependent on trailing icon presence),
  // see the From field's suggestionsContainer style above.
  premiumDropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  premiumDropdownMain: { fontFamily: 'Inter_500Medium', fontSize: 15, color: COLORS.textPrimary },
  premiumDropdownSecondary: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  recentLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  recentItemText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: COLORS.textPrimary, flex: 1 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary, marginTop: 16, marginBottom: 8 },
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  arrivalHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  arrivalDivider: { width: 1, height: 20, backgroundColor: COLORS.divider },
  arrivalText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: COLORS.textPrimary },
  warning: { fontFamily: 'Inter_400Regular', color: '#B4680A', fontSize: 13, marginTop: 6, marginBottom: 4 },
  transportRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
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
    marginTop: 20,
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

  // Loading modal
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18,21,61,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  loadingCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
  },
  loadingStepText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: COLORS.textPrimary,
    marginTop: 20,
    textAlign: 'center',
  },
  loadingDotsRow: { flexDirection: 'row', gap: 6, marginTop: 16 },
  loadingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.divider },
  loadingDotActive: { backgroundColor: COLORS.accent },

  // Result modal (its own full screen)
  resultScreen: { flex: 1, backgroundColor: COLORS.card },
  resultCloseButton: {
    position: 'absolute',
    top: 54,
    right: 20,
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
    paddingTop: 64,
    paddingBottom: 28,
    paddingHorizontal: 24,
  },
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
  freshnessBadgeInline: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#fff' },
  heroLayout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroTextCol: { flex: 1 },
  resultHeroLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  resultHeroTime: { fontFamily: 'Poppins_700Bold', fontSize: 40, color: '#fff', marginTop: 2 },
  resultArrivalInline: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  resultBody: { flex: 1, padding: 24 },
  divider: { height: 1, backgroundColor: COLORS.divider, marginVertical: 16 },
  whyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: COLORS.textPrimary, marginBottom: 12 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 10 },
  reasonText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, flex: 1 },
  feedbackPrompt: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: COLORS.textPrimary, marginBottom: 12 },
  feedbackRow: { flexDirection: 'row', gap: 8 },
  feedbackButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.canvas,
    alignItems: 'center',
  },
  feedbackButtonText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: COLORS.textPrimary },
  feedbackThanksRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feedbackThanks: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.signalGood },
});
