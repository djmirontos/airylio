import PostHog from 'posthog-react-native';

let client: PostHog | null = null;

export function initPostHog(): PostHog | null {
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;

  if (!apiKey) {
    console.warn('[PostHog] API key not found. PostHog will not initialize.');
    return null;
  }

  client = new PostHog(apiKey, {
    host: host ?? 'https://us.i.posthog.com',
    disabled: __DEV__,
  });

  return client;
}

export function getPostHog(): PostHog | null {
  return client;
}

export function identifyUser(deviceId: string): void {
  client?.identify(deviceId);
}

/**
 * Property type is derived from the client rather than declared as
 * Record<string, unknown>, which PostHog v4 rejects - its capture() takes a
 * narrower PostHogEventProperties, and that type lives in @posthog/core, a
 * transitive dependency this file should not import from directly.
 */
export function captureEvent(
  event: string,
  properties?: Parameters<PostHog['capture']>[1]
): void {
  client?.capture(event, properties);
}

export function resetPostHogUser(): void {
  client?.reset();
}
