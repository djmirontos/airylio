import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import TimePickerModal from './TimePickerModal';
import { NewCommuteProfile } from '../hooks/useCommuteProfiles';
import { CommuteProfile } from '../types/trip';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (profile: NewCommuteProfile) => void;
  onRequestSearch: (field: 'origin' | 'destination') => void;
  pendingSearchResult?: {
    field: 'origin' | 'destination';
    place: { label: string; lat: number; lng: number };
  } | null;
  initialValues?: CommuteProfile | null;
}

type TransportMode = CommuteProfile['transport_mode'];

// Same four modes, same order, same icons as the Plan screen selector.
const TRANSPORT_MODES: {
  key: TransportMode;
  label: string;
  iconSet: 'ion' | 'mci';
  iconName: string;
}[] = [
  { key: 'drive', label: 'Drive', iconSet: 'ion', iconName: 'car' },
  { key: 'motorcycle_taxi', label: 'Motorcycle', iconSet: 'mci', iconName: 'motorbike' },
  { key: 'public_commute', label: 'Commute', iconSet: 'ion', iconName: 'bus' },
  { key: 'walk', label: 'Walk', iconSet: 'ion', iconName: 'walk' },
];

const MAX_LABEL_LENGTH = 30;

interface PlaceValue {
  label: string;
  lat: number;
  lng: number;
}

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

/** Drops any seconds component so state is always "HH:MM". */
function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

function timeToDate(hhmm: string | null): Date {
  const date = new Date();
  if (!hhmm) return date;
  const [hourPart, minutePart] = hhmm.split(':');
  const hour24 = Number(hourPart);
  const minute = Number(minutePart);
  if (Number.isFinite(hour24) && Number.isFinite(minute)) {
    date.setHours(hour24, minute, 0, 0);
  }
  return date;
}

function dateToTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export default function CommuteProfileModal({
  visible,
  onClose,
  onSave,
  onRequestSearch,
  pendingSearchResult,
  initialValues,
}: Props) {
  const { colors: COLORS } = useTheme();
  const insets = useSafeAreaInsets();

  const [label, setLabel] = useState('');
  const [origin, setOrigin] = useState<PlaceValue | null>(null);
  const [destination, setDestination] = useState<PlaceValue | null>(null);
  const [arrivalTime, setArrivalTime] = useState<string | null>(null);
  const [transportMode, setTransportMode] = useState<TransportMode>('drive');
  const [morningBrief, setMorningBrief] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const prevVisibleRef = useRef(false);
  const appliedSearchRef = useRef<Props['pendingSearchResult']>(null);

  // Populates on the closed -> open transition rather than on mount: the parent
  // keeps this component mounted and only toggles `visible`, so a mount effect
  // would fire once and never again when a second profile is opened.
  //
  // Skipped when a search result is waiting. If the parent hides the modal while
  // the search screen is up, reopening must not wipe the half-filled draft that
  // is still sitting in state.
  useEffect(() => {
    const opening = visible && !prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!opening || pendingSearchResult) return;

    if (initialValues) {
      setLabel(initialValues.label);
      setOrigin({
        label: initialValues.origin_label,
        lat: initialValues.origin_lat,
        lng: initialValues.origin_lng,
      });
      setDestination({
        label: initialValues.destination_label,
        lat: initialValues.destination_lat,
        lng: initialValues.destination_lng,
      });
      setArrivalTime(normalizeTime(initialValues.target_arrival_time));
      setTransportMode(initialValues.transport_mode);
      setMorningBrief(initialValues.morning_brief_enabled);
    } else {
      setLabel('');
      setOrigin(null);
      setDestination(null);
      setArrivalTime(null);
      setTransportMode('drive');
      setMorningBrief(false);
    }
  }, [visible, initialValues, pendingSearchResult]);

  // Identity comparison, not a value comparison: the parent hands over a fresh
  // object per selection, so picking the same address twice still applies.
  useEffect(() => {
    if (!pendingSearchResult || pendingSearchResult === appliedSearchRef.current) return;
    appliedSearchRef.current = pendingSearchResult;

    if (pendingSearchResult.field === 'origin') {
      setOrigin(pendingSearchResult.place);
    } else {
      setDestination(pendingSearchResult.place);
    }
  }, [pendingSearchResult]);

  const canSave =
    label.trim().length > 0 && origin !== null && destination !== null && arrivalTime !== null;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: COLORS.canvas },
        content: { padding: 16, paddingBottom: 24 },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingBottom: 12,
        },
        headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: COLORS.textPrimary },
        closeButton: {
          padding: 8,
          marginRight: -8,
          minHeight: 44,
          minWidth: 44,
          alignItems: 'center',
          justifyContent: 'center',
        },
        fieldLabel: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 13,
          color: COLORS.textSecondary,
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        block: { marginBottom: 20 },
        input: {
          backgroundColor: COLORS.card,
          borderWidth: 1,
          borderColor: COLORS.divider,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 13,
          fontFamily: 'Inter_400Regular',
          fontSize: 15,
          color: COLORS.textPrimary,
          minHeight: 44,
        },
        fieldRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: COLORS.card,
          borderWidth: 1,
          borderColor: COLORS.divider,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 13,
          minHeight: 44,
        },
        fieldRowText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15 },
        transportRow: { flexDirection: 'row', gap: 8 },
        transportPill: {
          flex: 1,
          alignItems: 'center',
          gap: 6,
          paddingVertical: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: COLORS.divider,
          backgroundColor: COLORS.card,
          minHeight: 44,
          minWidth: 44,
        },
        transportPillSelected: {
          backgroundColor: COLORS.accent,
          borderColor: COLORS.accent,
          borderWidth: 1,
        },
        transportPillText: {
          fontFamily: 'Inter_500Medium',
          fontSize: 10.5,
          color: COLORS.textPrimary,
          textAlign: 'center',
        },
        transportPillTextSelected: {
          fontFamily: 'Inter_500Medium',
          fontSize: 10.5,
          color: '#fff',
          textAlign: 'center',
        },
        briefRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: COLORS.card,
          borderWidth: 1,
          borderColor: COLORS.divider,
          borderRadius: 14,
          padding: 14,
        },
        briefTextCol: { flex: 1 },
        briefLabel: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 14,
          color: COLORS.textPrimary,
          marginBottom: 2,
        },
        briefSubtitle: {
          fontFamily: 'Inter_400Regular',
          fontSize: 12,
          color: COLORS.textSecondary,
        },
        saveButton: {
          backgroundColor: COLORS.accent,
          paddingVertical: 16,
          borderRadius: 16,
          alignItems: 'center',
          minHeight: 44,
        },
        saveButtonDisabled: { opacity: 0.45 },
        saveButtonText: { fontFamily: 'Inter_600SemiBold', color: '#fff', fontSize: 16 },
        footer: {
          paddingHorizontal: 16,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: COLORS.divider,
          backgroundColor: COLORS.canvas,
        },
      }),
    [COLORS]
  );

  function handleSave() {
    if (!canSave || !origin || !destination || !arrivalTime) return;
    onSave({
      label: label.trim(),
      origin_label: origin.label,
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      destination_label: destination.label,
      destination_lat: destination.lat,
      destination_lng: destination.lng,
      target_arrival_time: arrivalTime,
      transport_mode: transportMode,
      morning_brief_enabled: morningBrief,
    });
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // Android hardware back. Without it the back press is swallowed and the
      // modal cannot be dismissed without reaching for the X.
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: Platform.OS === 'android' ? insets.top : 8 }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{initialValues ? 'Edit Commute' : 'New Commute'}</Text>
          <Pressable
            style={styles.closeButton}
            onPress={onClose}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>Label</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Daily Office, School Run"
              placeholderTextColor={COLORS.textSecondary}
              maxLength={MAX_LABEL_LENGTH}
              returnKeyType="done"
              accessibilityLabel="Commute label"
            />
          </View>

          <View style={styles.block}>
            <Text style={styles.fieldLabel}>From</Text>
            <Pressable
              style={styles.fieldRow}
              onPress={() => onRequestSearch('origin')}
              accessibilityLabel={origin ? `Origin: ${origin.label}. Change` : 'Set origin'}
              accessibilityRole="button"
            >
              <Ionicons name="location-outline" size={20} color={COLORS.accent} />
              <Text
                style={[
                  styles.fieldRowText,
                  { color: origin ? COLORS.textPrimary : COLORS.textSecondary },
                ]}
                numberOfLines={1}
              >
                {origin?.label ?? 'Set origin'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.block}>
            <Text style={styles.fieldLabel}>To</Text>
            <Pressable
              style={styles.fieldRow}
              onPress={() => onRequestSearch('destination')}
              accessibilityLabel={
                destination ? `Destination: ${destination.label}. Change` : 'Set destination'
              }
              accessibilityRole="button"
            >
              <Ionicons name="flag-outline" size={20} color={COLORS.accent} />
              <Text
                style={[
                  styles.fieldRowText,
                  { color: destination ? COLORS.textPrimary : COLORS.textSecondary },
                ]}
                numberOfLines={1}
              >
                {destination?.label ?? 'Set destination'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.block}>
            <Text style={styles.fieldLabel}>Arrive By</Text>
            <Pressable
              style={styles.fieldRow}
              onPress={() => setShowTimePicker(true)}
              accessibilityLabel={
                arrivalTime
                  ? `Arrival time: ${formatTime12Hour(arrivalTime)}. Change`
                  : 'Set arrival time'
              }
              accessibilityRole="button"
            >
              <Ionicons name="time-outline" size={20} color={COLORS.accent} />
              <Text
                style={[
                  styles.fieldRowText,
                  { color: arrivalTime ? COLORS.textPrimary : COLORS.textSecondary },
                ]}
              >
                {arrivalTime ? formatTime12Hour(arrivalTime) : 'Set arrival time'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.block}>
            <Text style={styles.fieldLabel}>Transport Mode</Text>
            <View style={styles.transportRow}>
              {TRANSPORT_MODES.map((mode) => {
                const selected = transportMode === mode.key;
                const IconComponent = mode.iconSet === 'mci' ? MaterialCommunityIcons : Ionicons;
                return (
                  <Pressable
                    key={mode.key}
                    style={[styles.transportPill, selected && styles.transportPillSelected]}
                    onPress={() => setTransportMode(mode.key)}
                    accessibilityLabel={`${mode.label} transport mode`}
                    accessibilityRole="button"
                  >
                    <IconComponent
                      name={mode.iconName as never}
                      size={18}
                      color={selected ? '#fff' : COLORS.accent}
                    />
                    <Text
                      style={selected ? styles.transportPillTextSelected : styles.transportPillText}
                    >
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.block}>
            <View style={styles.briefRow}>
              <Ionicons name="notifications-outline" size={20} color={COLORS.accent} />
              <View style={styles.briefTextCol}>
                <Text style={styles.briefLabel}>Morning Brief</Text>
                <Text style={styles.briefSubtitle}>
                  Notify me when to leave each weekday morning
                </Text>
              </View>
              <Switch
                value={morningBrief}
                onValueChange={setMorningBrief}
                trackColor={{ false: COLORS.divider, true: COLORS.accent }}
                thumbColor="#fff"
                accessibilityLabel="Toggle Morning Brief for this commute"
              />
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={!canSave}
            accessibilityLabel="Save commute"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
          >
            <Text style={styles.saveButtonText}>Save Commute</Text>
          </Pressable>
        </View>

        <TimePickerModal
          visible={showTimePicker}
          value={timeToDate(arrivalTime)}
          onConfirm={(selected) => {
            setArrivalTime(dateToTime(selected));
            setShowTimePicker(false);
          }}
          onCancel={() => setShowTimePicker(false)}
          colors={COLORS}
        />
      </View>
    </Modal>
  );
}
