import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { COMMUTE_PROFILES_KEY } from '../constants/config';
import { registerPushToken } from './useNotifications';
import { CommuteProfile } from '../types/trip';

const TABLE = 'commute_profiles';

/** Fields the caller supplies; the rest are assigned by the server or by us. */
export type NewCommuteProfile = Omit<
  CommuteProfile,
  'id' | 'device_id' | 'created_at' | 'baseline_leave_time'
>;

/**
 * Profiles created while the remote write was unavailable carry this prefix, so
 * a later pull can tell them apart from rows Postgres has actually seen and
 * avoid dropping them.
 */
const LOCAL_ID_PREFIX = 'local-';

function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

function localId(): string {
  return `${LOCAL_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function devLog(scope: string, err: unknown): void {
  if (__DEV__) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[useCommuteProfiles] ${scope}: ${message}`);
  }
}

/**
 * The row owner under RLS (`auth.uid() = device_id`).
 *
 * Reads the existing session but never creates one. Anonymous sign-in is owned
 * by tripService, which serialises it through a shared in-flight promise; a
 * second entry point calling signInAnonymously could mint a second anonymous
 * user and orphan the first identity's rows. With no session there is nothing
 * RLS would accept anyway, so the hook stays local-only until a trip is run.
 */
async function getDeviceId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch (err) {
    devLog('getSession', err);
    return null;
  }
}

/**
 * Stores the Expo push token against the device row the Morning Brief cron
 * reads. Keyed on `id`, matching the devices RLS policy (`auth.uid() = id`).
 */
async function savePushTokenToSupabase(token: string, deviceId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('devices')
      .update({ expo_push_token: token })
      .eq('id', deviceId);
    if (error) throw error;
  } catch (err) {
    devLog('savePushToken', err);
  }
}

export function useCommuteProfiles() {
  const [profiles, setProfiles] = useState<CommuteProfile[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Mirrors state so the mutators read the current list without closing over a
  // stale render, and without a dependency array on every callback.
  const profilesRef = useRef<CommuteProfile[]>([]);
  const mountedRef = useRef(true);

  const persist = useCallback(async (next: CommuteProfile[]): Promise<void> => {
    try {
      await AsyncStorage.setItem(COMMUTE_PROFILES_KEY, JSON.stringify(next));
    } catch (err) {
      devLog('persist', err);
    }
  }, []);

  const commit = useCallback(
    (next: CommuteProfile[]): void => {
      profilesRef.current = next;
      if (mountedRef.current) setProfiles(next);
      void persist(next);
    },
    [persist]
  );

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      // 1. Cache first, so the list paints without waiting on the network.
      try {
        const stored = await AsyncStorage.getItem(COMMUTE_PROFILES_KEY);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const cached = parsed as CommuteProfile[];
            profilesRef.current = cached;
            if (mountedRef.current) setProfiles(cached);
          }
        }
      } catch (err) {
        devLog('load cache', err);
      }

      if (mountedRef.current) setLoaded(true);

      // 2. Then reconcile with the server.
      const deviceId = await getDeviceId();
      if (!deviceId) return;

      try {
        const { data, error } = await supabase
          .from(TABLE)
          .select('*')
          .eq('device_id', deviceId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        if (!data) return;

        const remote = data as CommuteProfile[];
        // Anything still local-only has never been accepted by the server, so
        // it survives the pull rather than being overwritten out of existence.
        const unsynced = profilesRef.current.filter((p) => isLocalId(p.id));
        commit([...remote, ...unsynced]);
      } catch (err) {
        devLog('fetch', err);
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [commit]);

  const addProfile = useCallback(
    async (profile: NewCommuteProfile): Promise<CommuteProfile | null> => {
      const deviceId = await getDeviceId();
      let created: CommuteProfile | null = null;

      if (deviceId) {
        try {
          const { data, error } = await supabase
            .from(TABLE)
            .insert({ ...profile, device_id: deviceId })
            .select()
            .single();

          if (error) throw error;
          if (data) created = data as CommuteProfile;
        } catch (err) {
          devLog('addProfile', err);
        }
      }

      // The remote write failed or there was no session. Keep the profile
      // locally so the UI reflects the tap; the next successful write adopts it.
      if (!created) {
        created = {
          ...profile,
          id: localId(),
          baseline_leave_time: null,
          created_at: new Date().toISOString(),
        };
      }

      commit([...profilesRef.current, created]);
      return created;
    },
    [commit]
  );

  const updateProfile = useCallback(
    async (id: string, updates: Partial<CommuteProfile>): Promise<void> => {
      // Applied locally first: the row may be local-only, and the UI should not
      // wait on a round trip to reflect a toggle.
      const next = profilesRef.current.map((p) => (p.id === id ? { ...p, ...updates } : p));
      commit(next);

      if (isLocalId(id)) return;

      const deviceId = await getDeviceId();
      if (!deviceId) return;

      try {
        // id and device_id are never the caller's to change.
        const { id: _id, device_id: _deviceId, created_at: _createdAt, ...patch } = updates;
        if (Object.keys(patch).length === 0) return;

        const { error } = await supabase
          .from(TABLE)
          .update(patch)
          .eq('id', id)
          .eq('device_id', deviceId);

        if (error) throw error;
      } catch (err) {
        devLog('updateProfile', err);
      }
    },
    [commit]
  );

  const deleteProfile = useCallback(
    async (id: string): Promise<void> => {
      commit(profilesRef.current.filter((p) => p.id !== id));

      if (isLocalId(id)) return;

      const deviceId = await getDeviceId();
      if (!deviceId) return;

      try {
        const { error } = await supabase
          .from(TABLE)
          .delete()
          .eq('id', id)
          .eq('device_id', deviceId);

        if (error) throw error;
      } catch (err) {
        devLog('deleteProfile', err);
      }
    },
    [commit]
  );

  const toggleMorningBrief = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      await updateProfile(id, { morning_brief_enabled: enabled });

      if (enabled) {
        const token = await registerPushToken();
        if (token) {
          const deviceId = await getDeviceId();
          if (deviceId) await savePushTokenToSupabase(token, deviceId);
        }
      }
    },
    [updateProfile]
  );

  return { profiles, loaded, addProfile, updateProfile, deleteProfile, toggleMorningBrief };
}
