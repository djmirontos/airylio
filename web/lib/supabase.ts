import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Built on first use rather than at module scope.
 *
 * createClient throws on a missing or malformed URL, and this module is
 * imported during prerendering - so constructing it at import time made the
 * production build fail whenever the environment was not fully populated,
 * which is the normal state of a CI or preview build.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: true, storageKey: 'airylio-web-session' } }
    );
  }
  return client;
}

export async function getOrCreateSession(): Promise<string | null> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.access_token;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) return null;
  return data.session.access_token;
}

export default getSupabase;
