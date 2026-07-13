import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleLeaveReminder(
  leaveTime: string,
  destLabel: string
): Promise<string | null> {
  const granted = await requestNotificationPermission();
  if (!granted) return null;

  // Cancel any existing leave reminders
  await Notifications.cancelAllScheduledNotificationsAsync();

  const leaveDate = new Date(leaveTime);
  const now = new Date();

  if (leaveDate <= now) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '🚗 Time to leave!',
      body: `Your trip to ${destLabel} starts now. Have a safe journey!`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: leaveDate,
    },
  });

  return id;
}

export async function cancelLeaveReminder(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
