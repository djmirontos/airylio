import { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

interface AppConfig {
  minimum_version: string;
  latest_version: string;
  force_update: boolean;
  update_message: string;
  play_store_url: string;
}

function devLog(scope: string, err: unknown): void {
  if (__DEV__) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[useForceUpdate] ${scope}: ${message}`);
  }
}

function parseVersion(version: string): number[] {
  return version.split('.').map(Number);
}

function isVersionBelow(installed: string, minimum: string): boolean {
  const a = parseVersion(installed);
  const b = parseVersion(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}

/**
 * Checks Supabase once on mount for the minimum supported app version.
 *
 * Every failure path leaves updateRequired false: a config fetch problem
 * should never lock a user out of the app, only cost them the update prompt.
 */
export function useForceUpdate() {
  const [updateRequired, setUpdateRequired] = useState(false);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('app_config')
          .select('*')
          .eq('id', 1)
          .single();

        if (error || !data) return;
        if (!mountedRef.current) return;

        const config = data as AppConfig;
        setAppConfig(config);

        const installedVersion = Constants.expoConfig?.version ?? '0.0.0';

        if (config.force_update || isVersionBelow(installedVersion, config.minimum_version)) {
          setUpdateRequired(true);
        }
      } catch (err) {
        devLog('load', err);
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { updateRequired, appConfig };
}
