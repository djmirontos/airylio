import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, Switch, Linking } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { useFavorites } from '../hooks/useFavorites';
import { useCommuteProfiles, NewCommuteProfile } from '../hooks/useCommuteProfiles';
import CommuteProfileModal from '../components/CommuteProfileModal';
import { CommuteProfile } from '../types/trip';
import { MAX_COMMUTE_PROFILES } from '../constants/config';
import { useTheme } from '../context/ThemeContext';
import { captureEvent } from '../lib/posthog';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY!;

const TRANSPORT_MODE_LABELS: Record<CommuteProfile['transport_mode'], string> = {
  drive: 'Drive',
  motorcycle_taxi: 'Motorcycle',
  public_commute: 'Commute',
  walk: 'Walk',
};

/** "09:00" / "09:00:00" -> "9:00 AM". Postgres `time` returns seconds. */
function formatTime12Hour(hhmm: string): string {
  const [hourPart, minutePart] = hhmm.split(':');
  const hour24 = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return hhmm;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
}

export default function SettingsScreen() {
  const { favorites, loaded, saveFavorite, clearFavorite } = useFavorites();
  const {
    profiles,
    loaded: profilesLoaded,
    addProfile,
    updateProfile,
    deleteProfile,
    toggleMorningBrief,
  } = useCommuteProfiles();
  const { colors: COLORS, isDark, toggleTheme } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute();

  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [editingProfile, setEditingProfile] = useState<CommuteProfile | null>(null);
  const [pendingSearchResult, setPendingSearchResult] = useState<{
    field: 'origin' | 'destination';
    place: { label: string; lat: number; lng: number };
  } | null>(null);

  // On focus rather than mount: the tab stays mounted once visited, so a mount
  // effect would fire only the first time.
  useFocusEffect(
    useCallback(() => {
      captureEvent('settings_viewed');
    }, [])
  );

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.canvas },
    content: { paddingBottom: 32 },
    header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16 },
    headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: COLORS.textPrimary },
    section: { paddingHorizontal: 16, marginBottom: 24 },
    sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
    card: { backgroundColor: COLORS.card, borderRadius: 14, padding: 14, shadowColor: COLORS.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
    settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, justifyContent: 'space-between' },
    settingLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginLeft: 12, flex: 1 },
    favoriteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    favoriteLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    favoriteLabelCol: { flex: 1 },
    favoriteLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, marginBottom: 2 },
    favoriteValue: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary },
    clearButton: { padding: 8, marginRight: -8, minHeight: 44, minWidth: 44 },
    divider: { height: 1, backgroundColor: COLORS.divider },
    editButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: COLORS.accentTint, marginTop: 8, minHeight: 44 },
    editButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: COLORS.accent, textAlign: 'center' },
    emptyHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, paddingHorizontal: 16 },
    infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
    infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    infoLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary },
    infoValue: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary },
    linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
    linkLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, marginLeft: 12, flex: 1 },
    commuteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    commuteLeft: { flex: 1 },
    commuteActions: { alignItems: 'flex-end', gap: 4 },
    editIconButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    commuteLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, marginBottom: 2 },
    commuteRoute: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary, marginBottom: 2 },
    commuteMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: COLORS.textSecondary },
    commuteEmpty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', paddingVertical: 12 },
    addButton: { backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 10, minHeight: 44 },
    addButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
    maxHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 10 },
  }), [COLORS]);

  useEffect(() => {
    const params = route.params as
      | { selectedPlace?: { label: string; lat: number; lng: number }; type?: string }
      | undefined;
    if (!params?.selectedPlace) return;
    if (params.type === 'home' || params.type === 'work') {
      saveFavorite(params.type, params.selectedPlace);
    } else if (params.type === 'commute_origin' || params.type === 'commute_destination') {
      // Reopens the modal the search replaced. The draft is still in the modal's
      // state - it stayed mounted while the search screen was up - so setting the
      // pending result is enough to fill in the field the user went to look for.
      setPendingSearchResult({
        field: params.type === 'commute_origin' ? 'origin' : 'destination',
        place: params.selectedPlace,
      });
      setProfileModalVisible(true);
    }
    navigation.setParams({ selectedPlace: undefined, type: undefined });
  }, [route.params]);

  function handleRequestSearch(field: 'origin' | 'destination') {
    setProfileModalVisible(false);
    navigation.navigate('Search', {
      type: field === 'origin' ? 'commute_origin' : 'commute_destination',
      returnTo: 'SettingsMain',
      apiKey: GOOGLE_PLACES_API_KEY,
      placeholder: field === 'origin' ? 'Search origin address' : 'Search destination address',
    });
  }

  async function handleSaveProfile(profile: NewCommuteProfile) {
    if (editingProfile) {
      await updateProfile(editingProfile.id, profile);
    } else {
      await addProfile(profile);
    }
  }

  function handleEditCommute(profile: CommuteProfile) {
    setEditingProfile(profile);
    setPendingSearchResult(null);
    setProfileModalVisible(true);
  }

  function handleAddCommute() {
    setEditingProfile(null);
    setPendingSearchResult(null);
    setProfileModalVisible(true);
  }

  function editFavorite(type: 'home' | 'work') {
    navigation.navigate('Search', {
      type,
      returnTo: 'SettingsMain',
      apiKey: GOOGLE_PLACES_API_KEY,
      placeholder: `Search ${type} address`,
    });
  }

  function handleClear(type: 'home' | 'work') {
    Alert.alert('Clear Favorite', `Remove ${type} from favorites?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => clearFavorite(type),
      },
    ]);
  }

  if (!loaded) {
    return <View style={styles.container} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Ionicons name="moon" size={20} color={COLORS.accent} />
            <Text style={[styles.settingLabel, { color: COLORS.textPrimary }]}>Dark Mode</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: COLORS.divider, true: COLORS.accent }}
              thumbColor="#fff"
              accessibilityLabel="Toggle dark mode"
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Favorites</Text>
        <View style={styles.card}>
          {/* Home Row */}
          <View style={styles.favoriteRow}>
            <View style={styles.favoriteLeft}>
              <Ionicons name="home" size={20} color={COLORS.accent} />
              <View style={styles.favoriteLabelCol}>
                <Text style={styles.favoriteLabel}>Home</Text>
                <Text style={styles.favoriteValue} numberOfLines={1}>
                  {favorites.home?.label || 'Not set'}
                </Text>
              </View>
            </View>
            {favorites.home && (
              <Pressable style={styles.clearButton} onPress={() => handleClear('home')} accessibilityLabel="Clear home location" accessibilityRole="button">
                <Ionicons name="close" size={18} color={COLORS.signalRisk} />
              </Pressable>
            )}
          </View>

          <Pressable
            style={styles.editButton}
            onPress={() => editFavorite('home')}
            accessibilityLabel={`${favorites.home ? 'Edit' : 'Set'} home location`}
            accessibilityRole="button"
          >
            <Text style={styles.editButtonText}>{favorites.home ? 'Edit' : 'Set'}</Text>
          </Pressable>

          <View style={styles.divider} />

          {/* Work Row */}
          <View style={styles.favoriteRow}>
            <View style={styles.favoriteLeft}>
              <Ionicons name="briefcase" size={20} color={COLORS.accent} />
              <View style={styles.favoriteLabelCol}>
                <Text style={styles.favoriteLabel}>Work</Text>
                <Text style={styles.favoriteValue} numberOfLines={1}>
                  {favorites.work?.label || 'Not set'}
                </Text>
              </View>
            </View>
            {favorites.work && (
              <Pressable style={styles.clearButton} onPress={() => handleClear('work')} accessibilityLabel="Clear work location" accessibilityRole="button">
                <Ionicons name="close" size={18} color={COLORS.signalRisk} />
              </Pressable>
            )}
          </View>

          <Pressable
            style={styles.editButton}
            onPress={() => editFavorite('work')}
            accessibilityLabel={`${favorites.work ? 'Edit' : 'Set'} work location`}
            accessibilityRole="button"
          >
            <Text style={styles.editButtonText}>{favorites.work ? 'Edit' : 'Set'}</Text>
          </Pressable>
        </View>
        {!favorites.home && !favorites.work && (
          <Text style={styles.emptyHint}>Tap Set to save your Home or Work location for quick access.</Text>
        )}
      </View>

      {/* My Commutes Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Commutes</Text>
        {/* Nothing until the cache read resolves, so an empty card does not
            flash in front of a list that is about to arrive. */}
        {!profilesLoaded ? null : profiles.length === 0 ? (
          <>
            <View style={styles.card}>
              <Text style={styles.commuteEmpty}>No commutes saved yet</Text>
            </View>
            <Pressable
              style={styles.addButton}
              onPress={handleAddCommute}
              accessibilityLabel="Add commute"
              accessibilityRole="button"
            >
              <Text style={styles.addButtonText}>Add Commute</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.card}>
              {profiles.map((profile, index) => (
                <View key={profile.id}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.commuteRow}>
                    <View style={styles.commuteLeft}>
                      <Text style={styles.commuteLabel}>{profile.label}</Text>
                      <Text style={styles.commuteRoute} numberOfLines={1}>
                        {profile.origin_label} → {profile.destination_label}
                      </Text>
                      <Text style={styles.commuteMeta}>
                        Arrive by {formatTime12Hour(profile.target_arrival_time)} ·{' '}
                        {TRANSPORT_MODE_LABELS[profile.transport_mode] ?? profile.transport_mode}
                      </Text>
                    </View>
                    <View style={styles.commuteActions}>
                      <Pressable
                        style={styles.editIconButton}
                        onPress={() => handleEditCommute(profile)}
                        accessibilityLabel={`Edit ${profile.label}`}
                        accessibilityRole="button"
                      >
                        <Ionicons name="pencil-outline" size={18} color={COLORS.accent} />
                      </Pressable>
                      <Switch
                        value={profile.morning_brief_enabled}
                        onValueChange={(value) => toggleMorningBrief(profile.id, value)}
                        trackColor={{ false: COLORS.divider, true: COLORS.accent }}
                        thumbColor="#fff"
                        accessibilityLabel={`Morning Brief for ${profile.label}`}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
            {profiles.length < MAX_COMMUTE_PROFILES ? (
              <Pressable
                style={styles.addButton}
                onPress={handleAddCommute}
                accessibilityLabel="Add commute"
                accessibilityRole="button"
              >
                <Text style={styles.addButtonText}>Add Commute</Text>
              </Pressable>
            ) : (
              <Text style={styles.maxHint}>Maximum 5 commutes reached</Text>
            )}
          </>
        )}
      </View>

      {/* Legal Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://www.airylio.com/privacy.html')}
            accessibilityLabel="View Privacy Policy"
            accessibilityRole="button"
          >
            <View style={styles.infoRowLeft}>
              <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.accent} />
              <Text style={styles.linkLabel}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://www.airylio.com/terms.html')}
            accessibilityLabel="View Terms of Service"
            accessibilityRole="button"
          >
            <View style={styles.infoRowLeft}>
              <Ionicons name="document-text-outline" size={20} color={COLORS.accent} />
              <Text style={styles.linkLabel}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL('mailto:support@airylio.com')}
            accessibilityLabel="Contact support"
            accessibilityRole="button"
          >
            <View style={styles.infoRowLeft}>
              <Ionicons name="mail-outline" size={20} color={COLORS.accent} />
              <Text style={styles.linkLabel}>Contact Support</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="phone-portrait-outline" size={20} color={COLORS.accent} />
              <Text style={styles.infoLabel}>Version</Text>
            </View>
            <Text style={styles.infoValue}>
              {Constants.expoConfig?.version ?? '1.0.0'} ({Application.nativeBuildVersion ?? 'N/A'})
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="business-outline" size={20} color={COLORS.accent} />
              <Text style={styles.infoLabel}>Developer</Text>
            </View>
            <Text style={styles.infoValue}>Airyl Tech</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="location-outline" size={20} color={COLORS.accent} />
              <Text style={styles.infoLabel}>Built for</Text>
            </View>
            <Text style={styles.infoValue}>Philippine commuters</Text>
          </View>
        </View>
      </View>

      <CommuteProfileModal
        visible={profileModalVisible}
        onClose={() => {
          setProfileModalVisible(false);
          setEditingProfile(null);
          setPendingSearchResult(null);
        }}
        onSave={handleSaveProfile}
        onDelete={editingProfile ? () => deleteProfile(editingProfile.id) : undefined}
        onRequestSearch={handleRequestSearch}
        pendingSearchResult={pendingSearchResult}
        initialValues={editingProfile}
      />
    </ScrollView>
  );
}

