import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

interface SelectedPlace {
  label: string;
  lat: number;
  lng: number;
}

interface Props {
  apiKey: string;
  recentDestinations: RecentDestination[];
  onSelect: (place: SelectedPlace) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  suggestedLabel?: string;
  autoFocus?: boolean;
  colors: {
    accent: string;
    textPrimary: string;
    textSecondary: string;
    divider: string;
    card: string;
    signalRisk: string;
    ink: string;
  };
  favorites?: { home: FavoritePlace | null; work: FavoritePlace | null };
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

export default function DestinationAutocomplete({
  apiKey,
  recentDestinations,
  onSelect,
  onFocusChange,
  placeholder = 'Search destination',
  suggestedLabel = 'Suggested Locations',
  autoFocus = false,
  colors,
  favorites,
}: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<TextInput>(null);
  const containerRef = useRef<View>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionToken = useRef(Math.random().toString(36));

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  useEffect(() => {
    if (query.length < MIN_CHARS) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function measureDropdown() {
    containerRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0) setDropdownPos({ top: y + height + 4, left: x, width });
    });
  }

  async function fetchSuggestions(text: string) {
    setLoading(true);
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body: JSON.stringify({ input: text, includedRegionCodes: ['ph'], sessionToken: sessionToken.current }),
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
    } catch { setSuggestions([]); }
    finally { setLoading(false); }
  }

  async function selectSuggestion(item: Suggestion) {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${item.placeId}`, {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'location,formattedAddress' },
      });
      const data = await res.json();
      if (data.location) {
        onSelect({ label: data.formattedAddress ?? item.mainText, lat: data.location.latitude, lng: data.location.longitude });
        closeDropdown();
        sessionToken.current = Math.random().toString(36);
      }
    } catch {}
  }

  function closeDropdown() {
    setQuery('');
    setSuggestions([]);
    setFocused(false);
    onFocusChange?.(false);
  }

  function handleFocus() {
    if (blurRef.current) clearTimeout(blurRef.current);
    setFocused(true);
    onFocusChange?.(true);
    setTimeout(measureDropdown, 100);
  }

  function handleBlur() {
    blurRef.current = setTimeout(() => {
      setFocused(false);
      onFocusChange?.(false);
    }, 200);
  }

  const hasFavorites = !!(favorites?.home || favorites?.work);
  const hasRecent = recentDestinations.length > 0;
  const showSuggestions = query.length >= MIN_CHARS;

  return (
    <View ref={containerRef} onLayout={measureDropdown} style={styles.root}>
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.textPrimary }]}
        />
        {query.length > 0 && (
          <Pressable onPress={() => { setQuery(''); setSuggestions([]); inputRef.current?.focus(); }} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <Modal visible={focused} transparent animationType="none" onRequestClose={closeDropdown}>
        <Pressable style={styles.modalBackdrop} onPress={closeDropdown} />
        <View style={[styles.dropdown, {
          top: dropdownPos.top,
          left: dropdownPos.left,
          width: dropdownPos.width,
          backgroundColor: colors.card,
          borderColor: colors.divider,
        }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            {!showSuggestions ? (
              <>
                {hasFavorites && (
                  <>
                    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>Favorites</Text>
                    {favorites?.home && (
                      <Pressable style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => { onSelect({ label: favorites.home!.label, lat: favorites.home!.lat, lng: favorites.home!.lng }); closeDropdown(); }}>
                        <Ionicons name="home-outline" size={18} color={colors.accent} />
                        <View style={styles.itemTextCol}>
                          <Text style={[styles.itemTitle, { color: colors.textPrimary }]}>Home</Text>
                          <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{favorites.home.label}</Text>
                        </View>
                      </Pressable>
                    )}
                    {favorites?.work && (
                      <Pressable style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => { onSelect({ label: favorites.work!.label, lat: favorites.work!.lat, lng: favorites.work!.lng }); closeDropdown(); }}>
                        <Ionicons name="briefcase-outline" size={18} color={colors.accent} />
                        <View style={styles.itemTextCol}>
                          <Text style={[styles.itemTitle, { color: colors.textPrimary }]}>Work</Text>
                          <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{favorites.work.label}</Text>
                        </View>
                      </Pressable>
                    )}
                  </>
                )}
                {hasRecent && (
                  <>
                    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>Recent</Text>
                    {recentDestinations.map((item) => (
                      <Pressable key={item.label} style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => { onSelect({ label: item.label, lat: item.lat, lng: item.lng }); closeDropdown(); }}>
                        <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                        <Text style={[styles.itemSub, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </>
                )}
                {!hasFavorites && !hasRecent && (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Start typing to search</Text>
                )}
              </>
            ) : (
              <>
                {loading && <ActivityIndicator size="small" color={colors.accent} style={{ paddingVertical: 16 }} />}
                {suggestions.length > 0 && (
                  <>
                    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{suggestedLabel}</Text>
                    {suggestions.map((item) => (
                      <Pressable key={item.placeId} style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => selectSuggestion(item)}>
                        <Ionicons name="location-outline" size={18} color={colors.accent} />
                        <View style={styles.itemTextCol}>
                          <Text style={[styles.itemTitle, { color: colors.textPrimary }]} numberOfLines={1}>{item.mainText}</Text>
                          {!!item.secondaryText && <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{item.secondaryText}</Text>}
                        </View>
                      </Pressable>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {},
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, height: 22, fontSize: 15, fontFamily: 'Inter_500Medium', padding: 0, margin: 0 },
  clearBtn: { padding: 4, marginLeft: 4 },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
  dropdown: {
    position: 'absolute',
    maxHeight: 300,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    overflow: 'hidden',
  },
  sectionHeader: { fontFamily: 'Inter_600SemiBold', fontSize: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  itemTextCol: { flex: 1 },
  itemTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  itemSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', padding: 20 },
});
