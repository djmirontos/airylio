import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { supabase } from './lib/supabase';

const PRESET_ROUTES = [
  {
    label: 'SM North EDSA to BGC',
    originLat: 14.6560, originLng: 121.0300,
    destLat: 14.5547, destLng: 121.0244,
  },
  {
    label: 'Ayala Cebu to IT Park Cebu',
    originLat: 10.3181, originLng: 123.9053,
    destLat: 10.3280, destLng: 123.9060,
  },
];

const TRANSPORT_MODES = [
  { key: 'drive', label: 'Drive' },
  { key: 'motorcycle_taxi', label: 'Motorcycle Taxi' },
  { key: 'public_commute', label: 'Public Commute' },
  { key: 'bicycle', label: 'Bicycle' },
  { key: 'walk', label: 'Walk' },
];

interface TripResult {
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  dataFreshness: string;
}

export default function App() {
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [selectedMode, setSelectedMode] = useState('drive');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TripResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCalculate() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { error: authError } = await supabase.auth.signInAnonymously();
      if (authError) throw authError;

      const route = PRESET_ROUTES[selectedRoute];
      const arrivalTarget = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const { data, error: fnError } = await supabase.functions.invoke('calculate-trip', {
        body: {
          originLat: route.originLat,
          originLng: route.originLng,
          destLat: route.destLat,
          destLng: route.destLng,
          arrivalTarget,
          transportMode: selectedMode,
        },
      });

      if (fnError) {
        const bodyText = await fnError.context?.text?.();
        throw new Error(bodyText || fnError.message);
      }
      setResult(data);
    } catch (err: any) {
      const message = err.message ?? "Something went wrong";
      if (message.includes("no historical estimate available")) {
        setError("This route isn't available for the selected transport mode yet. Try a different mode.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Airylio</Text>
      <Text style={styles.subtitle}>When should you leave?</Text>

      <Text style={styles.label}>Route</Text>
      {PRESET_ROUTES.map((route, i) => (
        <Pressable
          key={route.label}
          style={[styles.optionButton, selectedRoute === i && styles.optionButtonSelected]}
          onPress={() => setSelectedRoute(i)}
        >
          <Text style={selectedRoute === i ? styles.optionTextSelected : styles.optionText}>
            {route.label}
          </Text>
        </Pressable>
      ))}

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

      <Pressable style={styles.calculateButton} onPress={handleCalculate} disabled={loading}>
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
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 60 },
  title: { fontSize: 32, fontWeight: 'bold' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 16, marginBottom: 8 },
  optionButton: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', marginBottom: 8 },
  optionButtonSelected: { backgroundColor: '#111', borderColor: '#111' },
  optionText: { fontSize: 15, color: '#111' },
  optionTextSelected: { fontSize: 15, color: '#fff' },
  calculateButton: { backgroundColor: '#0066ff', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  calculateButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#cc0000', marginTop: 16 },
  resultBox: { marginTop: 24, padding: 20, backgroundColor: '#f5f5f5', borderRadius: 16 },
  resultLabel: { fontSize: 14, color: '#666' },
  resultLeaveTime: { fontSize: 40, fontWeight: 'bold' },
  resultArrival: { fontSize: 16, color: '#333', marginTop: 4 },
  resultConfidence: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  resultFreshness: { fontSize: 12, color: '#999', marginTop: 4 },
  resultReason: { fontSize: 13, color: '#555', marginTop: 8 },
});


