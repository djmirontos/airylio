import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import ResultModal from '../components/ResultModal';

const COLORS = {
  canvas: '#FAFAFC',
  card: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B6F8A',
  divider: '#E7E7F1',
  accent: '#4C4F9E',
  signalGood: '#12B886',
  signalWarn: '#F5A623',
  signalRisk: '#E85D51',
};

const TRANSPORT_MODES: Record<string, { label: string; icon: string }> = {
  drive: { label: 'Drive', icon: 'car' },
  motorcycle_taxi: { label: 'Motorcycle', icon: 'motorbike' },
  public_commute: { label: 'Commute', icon: 'bus' },
  walk: { label: 'Walk', icon: 'walk' },
};

interface Trip {
  id: string;
  transport_mode: string;
  recommended_leave_time: string;
  predicted_arrival_time: string;
  confidence_score: number;
  planning_mode: string;
  created_at: string;
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
    planningMode?: 'arrive_by' | 'leave_at';
    factors: any[];
  };
}

function confidenceColor(score: number): string {
  if (score >= 85) return COLORS.signalGood;
  if (score >= 70) return COLORS.signalWarn;
  return COLORS.signalRisk;
}

function formatTime12h(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function HistoryScreen() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<TripResult | null>(null);

  const fetchTrips = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('trips')
        .select('id, transport_mode, recommended_leave_time, predicted_arrival_time, confidence_score, confidence_reason, recommendation_explanation, planning_mode, target_time, data_freshness, weather_condition, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setTrips(data || []);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load trip history');
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTrips();
    }, [fetchTrips])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTrips();
  }, [fetchTrips]);

  const handleTripPress = (trip: Trip) => {
    const result: TripResult = {
      tripId: trip.id,
      recommendedLeaveTime: trip.recommended_leave_time,
      predictedArrivalTime: trip.predicted_arrival_time,
      confidenceScore: trip.confidence_score,
      confidenceReason: trip.confidence_reason ?? [],
      dataFreshness: trip.data_freshness ?? 'cached',
      weatherCondition: trip.weather_condition,
      recommendationExplanation: trip.recommendation_explanation ?? {
        planningMode: trip.planning_mode as 'arrive_by' | 'leave_at',
        factors: [],
      },
    };
    setSelectedTrip(result);
  };

  const renderTripCard = ({ item }: { item: Trip }) => {
    const transportMode = TRANSPORT_MODES[item.transport_mode] || { label: 'Unknown', icon: 'help-circle' };
    const leaveTime = formatTime12h(item.recommended_leave_time);
    const arriveTime = formatTime12h(item.predicted_arrival_time);
    const date = formatDate(item.created_at);

    return (
      <Pressable style={styles.tripCard} onPress={() => handleTripPress(item)}>
        <View style={styles.tripCardLeft}>
          <View style={styles.transportBadge}>
            {item.transport_mode === 'motorcycle_taxi' ? (
              <MaterialCommunityIcons name="motorbike" size={20} color={COLORS.accent} />
            ) : (
              <Ionicons name={transportMode.icon as any} size={20} color={COLORS.accent} />
            )}
          </View>
        </View>

        <View style={styles.tripCardBody}>
          <Text style={styles.tripCardRoute}>Origin → Destination</Text>
          <Text style={styles.tripCardTimes}>Leave {leaveTime} · Arrive {arriveTime}</Text>
          <Text style={styles.tripCardDate}>{date}</Text>
        </View>

        <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor(item.confidence_score) }]}>
          <Text style={styles.confidenceBadgeText}>{Math.round(item.confidence_score)}%</Text>
        </View>
      </Pressable>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="time-outline" size={48} color={COLORS.signalWarn} />
      <Text style={styles.emptyTitle}>No trips yet</Text>
      <Text style={styles.emptySubtitle}>Your past trips will appear here after you calculate a route from the Plan tab.</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trip History</Text>
      </View>
      {loading && trips.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={trips}
          renderItem={renderTripCard}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={trips.length === 0 ? styles.emptyListContainer : { paddingTop: 8, paddingBottom: 20 }}
          scrollEnabled={trips.length > 0}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
        />
      )}

      <ResultModal
        result={selectedTrip}
        originLabel="Saved trip"
        destLabel="Saved trip"
        selectedDateTime={new Date()}
        planningMode={selectedTrip?.recommendationExplanation?.planningMode ?? 'arrive_by'}
        onClose={() => setSelectedTrip(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.canvas },
  header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: COLORS.canvas },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: '#1A1A2E' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyListContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: COLORS.textPrimary, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  tripCardLeft: { marginRight: 12 },
  transportBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: `${COLORS.accent}0f`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripCardBody: { flex: 1 },
  tripCardRoute: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary, marginBottom: 4 },
  tripCardTimes: { fontFamily: 'Inter_500Medium', fontSize: 12, color: COLORS.textSecondary, marginBottom: 2 },
  tripCardDate: { fontFamily: 'Inter_400Regular', fontSize: 11, color: COLORS.textSecondary },
  confidenceBadge: { width: 48, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  confidenceBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#fff' },
});







