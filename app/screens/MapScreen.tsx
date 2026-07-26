import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { decode } from '@mapbox/polyline';
import { useTheme } from '../context/ThemeContext';
import { useTripContext } from '../context/TripContext';

interface RouteCoord {
  latitude: number;
  longitude: number;
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

export default function MapScreen() {
  const { colors: COLORS } = useTheme();
  const { currentTrip, currentMeta } = useTripContext();
  const [decodedRoute, setDecodedRoute] = useState<RouteCoord[]>([]);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MapView>(null);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.canvas },
    map: { flex: 1 },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.canvas },
    emptyTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: COLORS.textPrimary, marginTop: 16, marginBottom: 8 },
    emptySubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
    infoCard: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.card, padding: 16 },
    timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    timeLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textPrimary },
    timeValue: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: COLORS.textPrimary, marginTop: 4 },
    divider: { height: 1, backgroundColor: COLORS.divider, marginVertical: 12 },
    detailsRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
    detailItem: { flex: 1 },
    detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textPrimary },
    detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, marginTop: 4 },
    buttonRow: { flexDirection: 'row', gap: 12 },
    navButton: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
    navButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#fff', marginLeft: 6 },
    wazeButton: {},
  }), [COLORS]);

  useEffect(() => {
    if (currentTrip?.encodedPolyline) {
      setLoading(true);
      try {
        const coordinates = decode(currentTrip.encodedPolyline);
        const routeCoords: RouteCoord[] = coordinates.map(([lat, lng]) => ({
          latitude: lat,
          longitude: lng,
        }));
        setDecodedRoute(routeCoords);

        setTimeout(() => {
          if (mapRef.current && routeCoords.length > 0) {
            mapRef.current.fitToCoordinates(routeCoords, {
              edgePadding: { top: 100, right: 50, bottom: 200, left: 50 },
              animated: true,
            });
          }
        }, 500);
      } catch (err) {
        console.error('Failed to decode polyline:', err);
      } finally {
        setLoading(false);
      }
    }
  }, [currentTrip?.encodedPolyline]);

  if (!currentTrip || !currentMeta) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="map-outline" size={48} color={COLORS.accent} />
          <Text style={styles.emptyTitle}>No route yet</Text>
          <Text style={styles.emptySubtitle}>Calculate a trip from the Plan tab to view the route on the map.</Text>
        </View>
      </View>
    );
  }

  const handleOpenGoogleMaps = () => {
    const url = `https://www.google.com/maps/dir/?api=1&origin=${currentMeta.originLat},${currentMeta.originLng}&destination=${currentMeta.destLat},${currentMeta.destLng}&travelmode=driving`;
    Linking.openURL(url);
  };

  const handleOpenWaze = () => {
    const url = `https://waze.com/ul?ll=${currentMeta.destLat},${currentMeta.destLng}&navigate=yes`;
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      ) : (
        <>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            mapType="standard"
            initialRegion={{
              latitude: currentMeta.originLat,
              longitude: currentMeta.originLng,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            <Marker
              coordinate={{
                latitude: currentMeta.originLat,
                longitude: currentMeta.originLng,
              }}
              title={currentMeta.originLabel}
              pinColor={COLORS.signalGood}
            />

            <Marker
              coordinate={{
                latitude: currentMeta.destLat,
                longitude: currentMeta.destLng,
              }}
              title={currentMeta.destLabel}
              pinColor={COLORS.signalRisk}
            />

            {decodedRoute.length > 0 && (
              <Polyline
                coordinates={decodedRoute}
                strokeColor={COLORS.accent}
                strokeWidth={4}
              />
            )}
          </MapView>

          <View style={styles.infoCard}>
            <View style={styles.timeRow}>
              <View>
                <Text style={styles.timeLabel}>Leave at</Text>
                <Text style={styles.timeValue}>{formatTime12h(currentTrip.recommendedLeaveTime)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color={COLORS.textSecondary} />
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.timeLabel}>Arrive</Text>
                <Text style={styles.timeValue}>{formatTime12h(currentTrip.predictedArrivalTime)}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailsRow}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Travel time</Text>
                <Text style={styles.detailValue}>{formatTravelTime(currentTrip.recommendedLeaveTime, currentTrip.predictedArrivalTime)}</Text>
              </View>
              {currentTrip.distanceMeters && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Distance</Text>
                  <Text style={styles.detailValue}>{formatDistance(currentTrip.distanceMeters)}</Text>
                </View>
              )}
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Confidence</Text>
                <Text style={styles.detailValue}>{Math.round(currentTrip.confidenceScore)}%</Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <Pressable style={styles.navButton} onPress={handleOpenGoogleMaps}>
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={styles.navButtonText}>Google Maps</Text>
              </Pressable>
              <Pressable style={[styles.navButton, styles.wazeButton]} onPress={handleOpenWaze}>
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={styles.navButtonText}>Waze</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
