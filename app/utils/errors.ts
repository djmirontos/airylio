// Sanitize error messages to prevent exposing internal details
export function sanitizeError(message: string): string {
  // Trip-related errors
  if (message.includes('no historical estimate available')) {
    return "This route isn't available for the selected transport mode yet. Try a different mode.";
  }
  if (message.includes('Location not in a supported city')) {
    return "This location isn't supported yet. Please try a location within the Philippines.";
  }
  if (message.includes('Internal server error') || message.includes('500')) {
    return "Something went wrong on our end. Please try again.";
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return "Connection error. Please check your internet and try again.";
  }
  // Generic database/constraint errors
  if (message.includes('UNIQUE constraint failed') || message.includes('duplicate key')) {
    return 'This destination has already been saved.';
  }
  if (message.includes('FOREIGN KEY constraint') || message.includes('invalid')) {
    return 'Unable to process this request. Please try again.';
  }
  if (message.includes('401') || message.includes('unauthorized')) {
    return 'Session expired. Please try again.';
  }
  if (message.includes('JSON') || message.includes('parse')) {
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
