import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  dropdownOffsetLeft?: number;
  dropdownOffsetRight?: number;
  useModal?: boolean;
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
const DEBOUNCE_MS = 150;

function generateToken(): string {
  return Math.random().toString(36).substring(2);
}

export default function DestinationAutocomplete({
  apiKey,
  recentDestinations,
  onSelect,
  onFocusChange,
  placeholder = 'Search destination',
  suggestedLabel = 'Suggested Locations',
  autoFocus = false,
  dropdownOffsetLeft = 0,
  dropdownOffsetRight = 0,
  useModal = false,
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
  const tokenRef = useRef(generateToken());

  // Auto focus
  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  // Fetch suggestions on query change
  useEffect(() => {
    if (query.length < MIN_CHARS) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function measurePosition() {
    setTimeout(() => {
      containerRef.current?.measureInWindow((x, y, width, height) => {
        if (width > 0) {
          setDropdownPos({ top: y + height + 4, left: x, width });
        }
      });
    }, 100);
  }

  async function fetchSuggestions(text: string) {
    setLoading(true);
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body: JSON.stringify({ input: text, includedRegionCodes: ['ph'], sessionToken: tokenRef.current }),
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
        close();
        tokenRef.current = generateToken();
      }
    } catch {}
  }

  function selectRecent(item: RecentDestination) {
    onSelect({ label: item.label, lat: item.lat, lng: item.lng });
    close();
  }

  function selectFavorite(place: FavoritePlace) {
    onSelect({ label: place.label, lat: place.lat, lng: place.lng });
    close();
  }

  function close() {
    setQuery('');
    setSuggestions([]);
    setFocused(false);
    onFocusChange?.(false);
  }

  function handleFocus() {
    if (blurRef.current) clearTimeout(blurRef.current);
    setFocused(true);
    onFocusChange?.(true);
    if (useModal) measurePosition();
  }

  function handleBlur() {
    blurRef.current = setTimeout(() => {
      setFocused(false);
      onFocusChange?.(false);
    }, 200);
  }

  const hasFavorites = !!(favorites?.home || favorites?.work);
  const hasRecent = recentDestinations.length > 0;
  const showDropdown = focused;

  const dropdownContent = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
      nestedScrollEnabled
    >
      {query.length === 0 ? (
        <>
          {hasFavorites && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Favorites</Text>
              {favorites?.home && (
                <Pressable style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => selectFavorite(favorites.home!)}>
                  <Ionicons name="home" size={15} color={colors.accent} />
                  <Text style={[styles.itemText, { color: colors.textPrimary }]}>Home</Text>
                </Pressable>
              )}
              {favorites?.work && (
                <Pressable style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => selectFavorite(favorites.work!)}>
                  <Ionicons name="briefcase" size={15} color={colors.accent} />
                  <Text style={[styles.itemText, { color: colors.textPrimary }]}>Work</Text>
                </Pressable>
              )}
            </>
          )}
          {hasRecent && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Recent</Text>
              {recentDestinations.map((item) => (
                <Pressable key={item.label} style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => selectRecent(item)}>
                  <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
                  <Text style={[styles.itemSubText, { color: colors.textSecondary }]} numberOfLines={1}>{item.label}</Text>
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
          {loading && <ActivityIndicator size="small" color={colors.accent} style={styles.loader} />}
          {suggestions.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{suggestedLabel}</Text>
              {suggestions.map((item) => (
                <Pressable key={item.placeId} style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => selectSuggestion(item)}>
                  <Ionicons name="location-outline" size={15} color={colors.accent} />
                  <View style={styles.suggestionText}>
                    <Text style={[styles.itemText, { color: colors.textPrimary }]} numberOfLines={1}>{item.mainText}</Text>
                    {!!item.secondaryText && <Text style={[styles.itemSubText, { color: colors.textSecondary }]} numberOfLines={1}>{item.secondaryText}</Text>}
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );

  if (useModal) {
    return (
      <View style={styles.root} ref={containerRef} onLayout={measurePosition}>
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

        <Modal visible={showDropdown} transparent animationType="none" onRequestClose={() => { setFocused(false); onFocusChange?.(false); }}>
          <Pressable style={styles.backdrop} onPress={() => { setFocused(false); onFocusChange?.(false); }} />
          <View style={{
            position: 'absolute',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            maxHeight: 260,
            backgroundColor: colors.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.divider,
            zIndex: 9999,
            elevation: 9999,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 12,
          }}>
            {dropdownContent}
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.root} ref={containerRef}>
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

      {showDropdown && (
        <>
          <Pressable
            style={styles.backdrop}
            onPress={() => { setFocused(false); onFocusChange?.(false); }}
          />
          <View style={[
            styles.dropdown,
            {
              left: dropdownOffsetLeft,
              right: dropdownOffsetRight,
              backgroundColor: colors.card,
              borderColor: colors.divider,
            }
          ]}>
            {dropdownContent}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, height: 22, fontSize: 15, fontFamily: 'Inter_500Medium', padding: 0, margin: 0 },
  clearBtn: { padding: 4, marginLeft: 4 },
  backdrop: {
    position: 'absolute',
    top: -9999,
    left: -9999,
    right: -9999,
    bottom: -9999,
    backgroundColor: 'transparent',
    zIndex: 100,
    elevation: 100,
  },
  dropdown: {
    position: 'absolute',
    top: '100%' as any,
    marginTop: 4,
    maxHeight: 260,
    borderRadius: 16,
    borderWidth: 1,
    zIndex: 9999,
    elevation: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  sectionLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  itemText: { fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  itemSubText: { fontFamily: 'Inter_400Regular', fontSize: 12, flex: 1 },
  suggestionText: { flex: 1 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', padding: 16 },
  loader: { paddingVertical: 12 },
});
