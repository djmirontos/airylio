import * as Sentry from '@sentry/react-native';

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    console.warn('[Sentry] DSN not found. Sentry will not initialize.');
    return;
  }

  Sentry.init({
    dsn,
    debug: __DEV__,
    tracesSampleRate: 0,
    environment: __DEV__ ? 'development' : 'production',
    enabled: !__DEV__,
  });
}

export function setSentryUser(deviceId: string): void {
  Sentry.setUser({ id: deviceId });
}

export function clearSentryUser(): void {
  Sentry.setUser(null);
}

export { Sentry };
