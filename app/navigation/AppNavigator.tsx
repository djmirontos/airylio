import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useTheme } from '../context/ThemeContext';
import { useTripContext } from '../context/TripContext';
import FeedbackModal from '../components/FeedbackModal';
import PlanScreen from '../App';
import HistoryScreen from '../screens/HistoryScreen';
import MapScreen from '../screens/MapScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SearchScreen from '../screens/SearchScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function PlanStackNavigator() {
  const { colors: COLORS } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        // Paints the screen container itself, so the sliding card is opaque and
        // never reveals the window background at its edges.
        contentStyle: { backgroundColor: COLORS.canvas },
      }}
    >
      <Stack.Screen name="PlanMain" component={PlanScreen} />
      <Stack.Group screenOptions={{ presentation: 'modal' }}>
        <Stack.Screen name="Search" component={SearchScreen} />
      </Stack.Group>
    </Stack.Navigator>
  );
}

function SettingsStackNavigator() {
  const { colors: COLORS } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        // Paints the screen container itself, so the sliding card is opaque and
        // never reveals the window background at its edges.
        contentStyle: { backgroundColor: COLORS.canvas },
      }}
    >
      <Stack.Screen name="SettingsMain" component={SettingsScreen} />
      <Stack.Group screenOptions={{ presentation: 'modal' }}>
        <Stack.Screen name="Search" component={SearchScreen} />
      </Stack.Group>
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { colors: COLORS } = useTheme();
  const { pendingFeedback, setPendingFeedback } = useTripContext();

  // Lives here rather than in Root: TripProvider wraps this component, so
  // useTripContext above ThemedNavigation would read the default context and
  // setPendingFeedback would be a no-op. This also stays mounted whichever tab
  // is open, so the tap works from anywhere in the app.
  useEffect(() => {
    function handle(response: Notifications.NotificationResponse | null) {
      if (!response) return;
      const data = response.notification.request.content.data;
      if (data?.type === 'feedback' && data?.tripId) {
        setPendingFeedback({
          tripId: data.tripId as string,
          destLabel: (data.destLabel as string) ?? 'your destination',
        });
      }
    }

    // Tapped while the app is running.
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    // Tapped while the app was closed - the response is waiting at startup.
    Notifications.getLastNotificationResponseAsync().then(handle).catch((err) => {
      console.warn('[AppNavigator] Could not read last notification response:', err?.message ?? err);
    });

    return () => subscription.remove();
  }, []);

  return (
    <>
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textSecondary,
        // Paints the strip the tab bar leaves behind when it hides for Search.
        sceneStyle: { backgroundColor: COLORS.canvas },
        // Decided from the focused nested route, so the bar is already gone in the
        // same commit that pushes Search. Reacting to the keyboard instead meant a
        // second layout pass landing mid-transition, which read as a jump.
        tabBarStyle: getFocusedRouteNameFromRoute(route) === 'Search' ? { display: 'none' } : {
          backgroundColor: COLORS.card,
          borderTopColor: COLORS.divider,
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 6,
          height: 64,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 11,
        },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, string> = {
            Plan: 'navigate',
            History: 'time',
            Map: 'map',
            Settings: 'settings',
          };
          const iconName = icons[route.name] ?? 'help-circle';
          return <Ionicons name={iconName as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Plan" component={PlanStackNavigator} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Settings" component={SettingsStackNavigator} />
    </Tab.Navigator>

    <FeedbackModal
      visible={!!pendingFeedback}
      tripId={pendingFeedback?.tripId ?? null}
      destLabel={pendingFeedback?.destLabel ?? 'your destination'}
      onClose={() => setPendingFeedback(null)}
    />
    </>
  );
}

