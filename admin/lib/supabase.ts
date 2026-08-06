import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS, so this must only ever be constructed on
 * the server - route handlers and server components. Importing it into a
 * 'use client' component would ship the key in the browser bundle.
 */
export function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
