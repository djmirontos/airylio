import { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable, ActivityIndicator, ScrollView, Platform } from 'react-native';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import GooglePlacesTextInput from 'react-native-google-places-textinput';
import { supabase } from './lib/supabase';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY!;

const TRANSPORT_MODES = [
  { key: 'drive', label: 'Drive' },
  { key: 'motorcycle_taxi', label: 'Motorcycle Taxi' },
  { key: 'public_commute', label: 'Public Commute' },
  { key: 'bicycle', label: 'Bicycle' },
  { key: 'walk', label: 'Walk' },
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
  const originRef = useRef<any>(null);

  const [destCoords, setDestCoords] = useState<Coords | null>(null);

  const [arrivalDate, setArrivalDate] = useState<Date>(startOfToday());
  const [arrivalTime, setArrivalTime] = useState<Date>(new Date(Date.now() + 60 * 60 * 1000));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [selectedMode, setSelectedMode] = useState('drive');
  const [loading, setLoading] = useState(false);
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

  function useCurrentLocation() {
    if (!gpsCoords) return;
    setOriginCoords(gpsCoords);
    setOriginLabel('Current Location');
    originRef.current?.clear();
  }

  const showGpsChip = originLabel === 'Current Location' && !!originCoords;

  const arrivalDateTime = combineDateAndTime(arrivalDate, arrivalTime);
  const isArrivalInFuture = arrivalDateTime.getTime() > Date.now();
  const canCalculate = !!originCoords && !!destCoords && isArrivalInFuture && !loading;

  async function handleCalculate() {
    if (!originCoords || !destCoords) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setFeedbackSubmitted(false);

    try {
      const { error: authError } = await supabase.auth.signInAnonymously();
      if (authError) throw authError;

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
      // Not surfacing an error here to avoid adding friction to an optional action.
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, styles.content]}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Airylio</Text>
      <Text style={styles.subtitle}>When should you leave?</Text>

      <View style={styles.labelRow}>
        <Text style={styles.label}>From</Text>
        {originLabel !== 'Current Location' && gpsCoords && (
          <Pressable onPress={useCurrentLocation}>
            <Text style={styles.linkText}>Use current location</Text>
          </Pressable>
        )}
      </View>
      {showGpsChip ? (
        <Pressable style={styles.staticField} onPress={() => originRef.current?.focus()}>
          <Text style={styles.staticFieldText}>Current Location</Text>
        </Pressable>
      ) : null}
      <GooglePlacesTextInput
        ref={originRef}
        apiKey={GOOGLE_PLACES_API_KEY}
        placeHolderText={locationError ?? 'Search origin'}
        fetchDetails
        detailsFields={['location', 'formattedAddress']}
        includedRegionCodes={['ph']}
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
          container: {
            marginBottom: 8,
            display: showGpsChip ? 'none' : 'flex',
          },
          input: styles.autocompleteInput,
        }}
      />

      <Text style={styles.label}>To</Text>
      <GooglePlacesTextInput
        apiKey={GOOGLE_PLACES_API_KEY}
        placeHolderText="Search destination"
        fetchDetails
        detailsFields={['location', 'formattedAddress']}
        includedRegionCodes={['ph']}
        onPlaceSelect={(place: any) => {
          if (place.details?.location) {
            setDestCoords({
              lat: place.details.location.latitude,
              lng: place.details.location.longitude,
            });
          }
        }}
        style={{
          container: { marginBottom: 8 },
          input: styles.autocompleteInput,
        }}
      />

      <Text style={styles.label}>Arrive by</Text>
      <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
      <Pressable style={styles.staticField} onPress={() => setShowDatePicker(true)}>
        <Text style={styles.staticFieldText}>
          {arrivalDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
        </Text>
      </Pressable>
      <Pressable style={styles.staticField} onPress={() => setShowTimePicker(true)}>
        <Text style={styles.staticFieldText}>
          {arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </Pressable>
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

      <Text style={styles.label}>Transport</Text>
      {TRANSPORT_MODES.map((mode) => (
        <Pressable
          key={mode.key}
          style={[styles.optionButton, selectedMode === mode.key && styles.optionButtonSelected]}
          onPress={() => setSelectedMode(mode.key)}
        >
          <Text style={selectedMode === mode.key ? styles.optionTextSelected : styles.optionText}>
            {mode.label}
          </Text>
        </Pressable>
      ))}

      <Pressable
        style={[styles.calculateButton, !canCalculate && styles.calculateButtonDisabled]}
        onPress={handleCalculate}
        disabled={!canCalculate}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.calculateButtonText}>Calculate</Text>}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>Leave by</Text>
          <Text style={styles.resultLeaveTime}>
            {new Date(result.recommendedLeaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={styles.resultArrival}>
            Arrive around {new Date(result.predictedArrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={styles.resultConfidence}>{result.confidenceScore}% confidence</Text>
          <Text style={styles.resultFreshness}>Data: {result.dataFreshness}</Text>
          {result.confidenceReason.map((reason, i) => (
            <Text key={i} style={styles.resultReason}>- {reason}</Text>
          ))}

          <Text style={styles.feedbackPrompt}>How did it go?</Text>
          {feedbackSubmitted ? (
            <Text style={styles.feedbackThanks}>✓ Thanks for your feedback!</Text>
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
        </View>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 60 },
  scrollArea: { flex: 1 },
  title: { fontSize: 32, fontWeight: 'bold' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 24 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  linkText: { fontSize: 13, color: '#0066ff' },
  staticField: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', marginBottom: 8 },
  staticFieldText: { fontSize: 15, color: '#111' },
  autocompleteInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 14,
    fontSize: 15,
  },
  optionButton: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', marginBottom: 8 },
  optionButtonSelected: { backgroundColor: '#111', borderColor: '#111' },
  optionText: { fontSize: 15, color: '#111' },
  optionTextSelected: { fontSize: 15, color: '#fff' },
  calculateButton: { backgroundColor: '#0066ff', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  calculateButtonDisabled: { backgroundColor: '#aac4f5' },
  calculateButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  warning: { color: '#cc6600', fontSize: 13, marginBottom: 8 },
  error: { color: '#cc0000', marginTop: 16 },
  resultBox: { marginTop: 24, padding: 20, backgroundColor: '#f5f5f5', borderRadius: 16 },
  resultLabel: { fontSize: 14, color: '#666' },
  resultLeaveTime: { fontSize: 40, fontWeight: 'bold' },
  resultArrival: { fontSize: 16, color: '#333', marginTop: 4 },
  resultConfidence: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  resultFreshness: { fontSize: 12, color: '#999', marginTop: 4 },
  resultReason: { fontSize: 13, color: '#555', marginTop: 8 },
  feedbackPrompt: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 20, marginBottom: 10 },
  feedbackRow: { flexDirection: 'row', gap: 8 },
  feedbackButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  feedbackButtonText: { fontSize: 13, color: '#111' },
  feedbackThanks: { fontSize: 14, color: '#00805a', fontWeight: '600' },
});
