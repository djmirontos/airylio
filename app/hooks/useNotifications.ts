import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowAlert is deprecated in SDK 54; banner/list replace it. Both are
    // required by NotificationBehavior, and omitting them meant foreground
    // notifications had no defined presentation.
    shouldShowBanner: true,
    shouldShowList: true,
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
  arrivalTime: string,
  destLabel: string,
  tripId: string
): Promise<string | null> {
  const granted = await requestNotificationPermission();
  if (!granted) return null;

  await Notifications.cancelAllScheduledNotificationsAsync();

  const leaveDate = new Date(leaveTime);
  const arrivalDate = new Date(arrivalTime);
  const now = new Date();

  if (leaveDate <= now) return null;

  // Schedule leave reminder
  const leaveId = await Notifications.scheduleNotificationAsync({
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

  // Schedule arrival feedback notification (only if arrival is in the future)
  if (arrivalDate > now) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🏁 Did you arrive on time?',
        body: `How was your trip to ${destLabel}? Tap to rate it.`,
        sound: false,
        data: { tripId, type: 'feedback', destLabel },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: arrivalDate,
      },
    });
  }

  return leaveId;
}

export async function cancelLeaveReminder(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function registerPushToken(): Promise<string | null> {
  // Push tokens only exist on physical devices. Expo returns a mock token on
  // simulators that the Expo push service rejects — skip registration entirely.
  if (!Device.isDevice) {
    if (__DEV__) console.warn('[useNotifications] Push token skipped — not a physical device');
    return null;
  }

  const granted = await requestNotificationPermission();
  if (!granted) return null;

  try {
    // No projectId argument: it resolves from Constants.expoConfig.extra.eas
    // .projectId, which app.config.js sets. Passing it explicitly is the
    // documented recommendation if that ever stops being true.
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch (err) {
    if (__DEV__) console.warn('[useNotifications] Failed to get push token:', err);
    return null;
  }
}
