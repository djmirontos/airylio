import { useEffect, useState, useRef } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface TimePickerModalProps {
  visible: boolean;
  value: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  colors: {
    accent: string;
    ink: string;
    card: string;
    canvas: string;
    textPrimary: string;
    textSecondary: string;
    divider: string;
  };
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function to12Hour(date: Date): { hour: number; minute: number; period: 'AM' | 'PM' } {
  let hour = date.getHours();
  const period: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return { hour, minute: date.getMinutes(), period };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export default function TimePickerModal({ visible, value, onConfirm, onCancel, colors }: TimePickerModalProps) {
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');
  const [activeTab, setActiveTab] = useState<'time' | 'now'>('time');
  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      const parsed = to12Hour(new Date());
      setHour(parsed.hour);
      setMinute(parsed.minute);
      setPeriod(parsed.period);
      setActiveTab('time');

      setTimeout(() => {
        const hourIndex = HOURS.indexOf(parsed.hour);
        const minuteIndex = parsed.minute;
        if (hourScrollRef.current) {
          hourScrollRef.current.scrollTo({ y: Math.max(0, (hourIndex - 2) * 42), animated: false });
        }
        if (minuteScrollRef.current) {
          minuteScrollRef.current.scrollTo({ y: Math.max(0, (minuteIndex - 2) * 42), animated: false });
        }
      }, 50);
    }
  }, [visible]);

  function handleNow() {
    const parsed = to12Hour(new Date());
    setHour(parsed.hour);
    setMinute(parsed.minute);
    setPeriod(parsed.period);
    setActiveTab('now');

    setTimeout(() => {
      const hourIndex = HOURS.indexOf(parsed.hour);
      const minuteIndex = parsed.minute;
      if (hourScrollRef.current) {
        hourScrollRef.current.scrollTo({ y: Math.max(0, (hourIndex - 2) * 42), animated: true });
      }
      if (minuteScrollRef.current) {
        minuteScrollRef.current.scrollTo({ y: Math.max(0, (minuteIndex - 2) * 42), animated: true });
      }
    }, 50);
  }

  function handleDone() {
    let hour24 = hour % 12;
    if (period === 'PM') hour24 += 12;
    const result = new Date(value);
    result.setHours(hour24, minute, 0, 0);
    onConfirm(result);
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Select Time</Text>

          <View style={[styles.previewRow, { borderColor: colors.divider }]}>
            <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
            <Text style={[styles.previewText, { color: colors.textPrimary }]}>
              {pad(hour)} : {pad(minute)}
            </Text>
            <View style={[styles.previewPeriodBadge, { backgroundColor: colors.accent }]}>
              <Text style={styles.previewPeriodText}>{period}</Text>
            </View>
          </View>

          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tabButton, activeTab === 'time' && { backgroundColor: colors.accent }]}
              onPress={() => setActiveTab('time')}
            >
              <Ionicons name="time-outline" size={15} color={activeTab === 'time' ? '#fff' : colors.textSecondary} />
              <Text style={[styles.tabText, { color: activeTab === 'time' ? '#fff' : colors.textSecondary }]}>Time</Text>
            </Pressable>
            <Pressable
              style={[styles.tabButton, activeTab === 'now' && { backgroundColor: colors.accent }]}
              onPress={handleNow}
            >
              <Ionicons name="sunny-outline" size={15} color={activeTab === 'now' ? '#fff' : colors.textSecondary} />
              <Text style={[styles.tabText, { color: activeTab === 'now' ? '#fff' : colors.textSecondary }]}>Now</Text>
            </Pressable>
          </View>

          <View style={styles.wheelRow}>
            <ScrollView ref={hourScrollRef} style={[styles.wheelColumn, { backgroundColor: colors.canvas }]} showsVerticalScrollIndicator={false}>
              {HOURS.map((h) => (
                <Pressable
                  key={h}
                  style={[styles.wheelItem, h === hour && { backgroundColor: colors.accent }]}
                  onPress={() => setHour(h)}
                >
                  <Text style={[styles.wheelItemText, { color: h === hour ? '#fff' : colors.textSecondary }]}>
                    {pad(h)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <ScrollView ref={minuteScrollRef} style={[styles.wheelColumn, { backgroundColor: colors.canvas }]} showsVerticalScrollIndicator={false}>
              {MINUTES.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.wheelItem, m === minute && { backgroundColor: colors.accent }]}
                  onPress={() => setMinute(m)}
                >
                  <Text style={[styles.wheelItemText, { color: m === minute ? '#fff' : colors.textSecondary }]}>
                    {pad(m)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.periodColumn}>
              <Pressable
                style={[styles.periodButton, { borderColor: colors.divider }, period === 'AM' && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                onPress={() => setPeriod('AM')}
              >
                <Text style={[styles.periodButtonText, { color: period === 'AM' ? '#fff' : colors.textSecondary }]}>AM</Text>
              </Pressable>
              <Pressable
                style={[styles.periodButton, { borderColor: colors.divider }, period === 'PM' && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                onPress={() => setPeriod('PM')}
              >
                <Text style={[styles.periodButtonText, { color: period === 'PM' ? '#fff' : colors.textSecondary }]}>PM</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.footerRow}>
            <Pressable style={[styles.footerButton, { borderColor: colors.divider }]} onPress={onCancel}>
              <Text style={[styles.footerButtonText, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.footerButton, { backgroundColor: colors.accent, borderColor: colors.accent }]} onPress={handleDone}>
              <Text style={[styles.footerButtonText, { color: '#fff' }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(18,21,61,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 340, borderRadius: 20, padding: 20 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 14 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  previewText: { fontFamily: 'Poppins_700Bold', fontSize: 20, flex: 1 },
  previewPeriodBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  previewPeriodText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#fff' },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tabButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12 },
  tabText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  wheelRow: { flexDirection: 'row', gap: 8, height: 160, marginBottom: 16 },
  wheelColumn: { flex: 1, borderRadius: 12 },
  wheelItem: { paddingVertical: 10, alignItems: 'center', borderRadius: 8, marginHorizontal: 4, marginVertical: 1 },
  wheelItemText: { fontFamily: 'Poppins_700Bold', fontSize: 16 },
  periodColumn: { width: 56, gap: 8, justifyContent: 'center' },
  periodButton: { paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  periodButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  footerRow: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  footerButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
