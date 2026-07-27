import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { FavoritePlace } from '../hooks/useFavorites';

interface RecentDestination {
  label: string;
  lat: number;
  lng: number;
}

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

interface RouteParams {
  type: 'origin' | 'destination';
  recentDestinations: RecentDestination[];
  favorites: { home: FavoritePlace | null; work: FavoritePlace | null };
  apiKey: string;
  placeholder: string;
}

interface ListItem {
  id: string;
  type: 'favorite-home' | 'favorite-work' | 'recent' | 'suggestion';
  data: any;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

export default function SearchScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { colors: COLORS } = useTheme();
  const { type, recentDestinations, favorites, apiKey, placeholder } = route.params as RouteParams;

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (query.length < MIN_CHARS) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function fetchSuggestions(text: string) {
    setLoading(true);
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
        },
        body: JSON.stringify({ input: text, includedRegionCodes: ['ph'] }),
      });
      const data = await res.json();
      setSuggestions(
        (data.suggestions ?? [])
          .filter((s: any) => s.placePrediction)
          .map((s: any) => ({
            placeId: s.placePrediction.placeId,
            mainText: s.placePrediction.structuredFormat?.mainText?.text ?? '',
            secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
          }))
      );
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectSuggestion(item: Suggestion) {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${item.placeId}`, {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'location,formattedAddress' },
      });
      const data = await res.json();
      if (data.location) {
        navigation.navigate('Plan', {
          selectedPlace: {
            label: data.formattedAddress ?? item.mainText,
            lat: data.location.latitude,
            lng: data.location.longitude,
          },
          type,
        });
      }
    } catch {}
  }

  const showSuggestions = query.length >= MIN_CHARS;
  const hasFavorites = !!(favorites?.home || favorites?.work);
  const hasRecent = recentDestinations.length > 0;

  let items: ListItem[] = [];

  if (!showSuggestions) {
    if (hasFavorites) {
      if (favorites?.home) items.push({ id: 'fav-home', type: 'favorite-home', data: favorites.home });
      if (favorites?.work) items.push({ id: 'fav-work', type: 'favorite-work', data: favorites.work });
    }
    if (hasRecent) {
      recentDestinations.forEach((item, i) => {
        items.push({ id: `recent-${i}`, type: 'recent', data: item });
      });
    }
  } else {
    suggestions.forEach((item) => {
      items.push({ id: `suggestion-${item.placeId}`, type: 'suggestion', data: item });
    });
  }

  const renderHeader = () => {
    if (!showSuggestions) {
      if (hasFavorites) {
        return <Text style={[styles.sectionHeader, { color: COLORS.textSecondary }]}>FAVORITES</Text>;
      }
      if (hasRecent) {
        return <Text style={[styles.sectionHeader, { color: COLORS.textSecondary }]}>RECENT</Text>;
      }
    }
    if (showSuggestions) {
      return <Text style={[styles.sectionHeader, { color: COLORS.textSecondary }]}>SUGGESTED LOCATIONS</Text>;
    }
    return null;
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'favorite-home') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() =>
            navigation.navigate('Plan', {
              selectedPlace: {
                label: item.data.label,
                lat: item.data.lat,
                lng: item.data.lng,
              },
              type,
            })
          }
        >
          <Ionicons name="home-outline" size={18} color={COLORS.accent} />
          <View style={styles.itemTextCol}>
            <Text style={[styles.itemTitle, { color: COLORS.textPrimary }]}>Home</Text>
            <Text style={[styles.itemSub, { color: COLORS.textSecondary }]} numberOfLines={1}>
              {item.data.label}
            </Text>
          </View>
        </Pressable>
      );
    }
    if (item.type === 'favorite-work') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() =>
            navigation.navigate('Plan', {
              selectedPlace: {
                label: item.data.label,
                lat: item.data.lat,
                lng: item.data.lng,
              },
              type,
            })
          }
        >
          <Ionicons name="briefcase-outline" size={18} color={COLORS.accent} />
          <View style={styles.itemTextCol}>
            <Text style={[styles.itemTitle, { color: COLORS.textPrimary }]}>Work</Text>
            <Text style={[styles.itemSub, { color: COLORS.textSecondary }]} numberOfLines={1}>
              {item.data.label}
            </Text>
          </View>
        </Pressable>
      );
    }
    if (item.type === 'recent') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() =>
            navigation.navigate('Plan', {
              selectedPlace: {
                label: item.data.label,
                lat: item.data.lat,
                lng: item.data.lng,
              },
              type,
            })
          }
        >
          <Ionicons name="time-outline" size={18} color={COLORS.textSecondary} />
          <Text style={[styles.itemSub, { color: COLORS.textSecondary, flex: 1 }]} numberOfLines={2}>
            {item.data.label}
          </Text>
        </Pressable>
      );
    }
    if (item.type === 'suggestion') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() => selectSuggestion(item.data)}
        >
          <Ionicons name="location-outline" size={18} color={COLORS.accent} />
          <View style={styles.itemTextCol}>
            <Text style={[styles.itemTitle, { color: COLORS.textPrimary }]} numberOfLines={1}>
              {item.data.mainText}
            </Text>
            {!!item.data.secondaryText && (
              <Text style={[styles.itemSub, { color: COLORS.textSecondary }]} numberOfLines={1}>
                {item.data.secondaryText}
              </Text>
            )}
          </View>
        </Pressable>
      );
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: COLORS.canvas }]}>
      <View style={[styles.header, { borderBottomColor: COLORS.divider }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textSecondary}
          style={[styles.searchInput, { color: COLORS.textPrimary }]}
        />
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={COLORS.accent} />
        </View>
      )}

      {!loading && showSuggestions && suggestions.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: COLORS.textSecondary }]}>No results found</Text>
        </View>
      )}

      {!loading && (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          scrollEnabled={items.length > 3}
          showsVerticalScrollIndicator={true}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1 },
  backBtn: { padding: 8, marginRight: 8 },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    paddingHorizontal: 12,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  sectionHeader: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  itemTextCol: { flex: 1 },
  itemTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  itemSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
});
