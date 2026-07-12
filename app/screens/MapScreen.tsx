import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <Ionicons name="map-outline" size={48} color="#9B9DC2" />
      <Text style={styles.title}>No route yet</Text>
      <Text style={styles.subtitle}>Calculate a trip from the Plan tab to view it on the map.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFC', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#1A1A2E', marginTop: 16, marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#6B6F8A', textAlign: 'center', lineHeight: 22 },
});
