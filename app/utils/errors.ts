// Sanitize error messages to prevent exposing internal details.
//
// Matching is done on a lowercased copy. It used to test the raw string, so
// React Native's offline error - "Network request failed", capital N - never
// matched includes('network') and the most common real failure fell through to
// the vague catch-all.
export function sanitizeError(message: string): string {
  const m = (message ?? '').toLowerCase();

  // Connectivity. Checked first: when the device is offline every other
  // classification below is a guess at a response that never arrived.
  if (
    m.includes('network') ||
    m.includes('fetch') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('failed to send a request') || // supabase-js functions.invoke, offline
    m.includes('connection')
  ) {
    return 'Connection error. Please check your internet and try again.';
  }

  // Trip-related errors
  if (m.includes('no historical estimate available')) {
    return "This route isn't available for the selected transport mode yet. Try a different mode.";
  }
  if (m.includes('location not in a supported city')) {
    return "This location isn't supported yet. Please try a location within the Philippines.";
  }
  if (m.includes('too many requests') || m.includes('429')) {
    return "You've made a lot of requests just now. Please wait a moment and try again.";
  }
  if (m.includes('internal server error') || m.includes('500')) {
    return 'Something went wrong on our end. Please try again.';
  }

  // Session errors, before the broad 'invalid' test below - "Invalid or expired
  // session" would otherwise be caught by it and reported as a bad request.
  if (m.includes('401') || m.includes('unauthorized') || m.includes('expired session')) {
    return 'Session expired. Please try again.';
  }

  // Generic database/constraint errors
  if (m.includes('unique constraint failed') || m.includes('duplicate key')) {
    return 'This destination has already been saved.';
  }
  if (m.includes('foreign key constraint') || m.includes('invalid')) {
    return 'Unable to process this request. Please try again.';
  }
  if (m.includes('json') || m.includes('parse')) {
    return 'Unable to load data. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

// Log errors for debugging without exposing to user
export function logError(context: string, error: unknown): void {
  if (__DEV__) {
    console.error(`[${context}]`, error);
  }
}
