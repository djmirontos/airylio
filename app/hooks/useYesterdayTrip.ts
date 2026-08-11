import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface YesterdayTrip {
  tripId: string;
  originLabel: string;
  destinationLabel: string;
  recommendedLeaveTime: string;
  createdAt: string;
}

interface TripRow {
  id: string;
  origin_label: string | null;
  destination_label: string | null;
  recommended_leave_time: string;
  created_at: string;
}

function devLog(scope: string, err: unknown): void {
  if (__DEV__) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[useYesterdayTrip] ${scope}: ${message}`);
  }
}

/**
 * Yesterday's most recent trip that the user has not rated yet.
 *
 * Runs once on mount. Every failure path resolves to `null` rather than
 * throwing: this drives an optional banner, and a query problem should cost the
 * user nothing more than not seeing it.
 *
 * Reads the existing session but never creates one, for the same reason as
 * useCommuteProfiles - anonymous sign-in is serialised inside tripService, and
 * a second caller could mint a second identity that orphans the first one's
 * trips.
 */
export function useYesterdayTrip() {
  const [yesterdayTrip, setYesterdayTrip] = useState<YesterdayTrip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const deviceId = sessionData.session?.user.id;
        if (!deviceId) return;

        // Device-local calendar day, not UTC: "yesterday" has to mean what the
        // user's own clock says, or a Manila evening trip reads as today.
        const start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setHours(23, 59, 59, 999);

        const { data: tripRows, error: tripError } = await supabase
          .from('trips')
          .select('id, origin_label, destination_label, recommended_leave_time, created_at')
          .eq('device_id', deviceId)
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())
          .order('created_at', { ascending: false });

        if (tripError) throw tripError;
        if (!tripRows || tripRows.length === 0) return;

        const trips = tripRows as TripRow[];

        // Which of yesterday's trips already carry feedback. Fetched in one
        // round trip rather than per-trip, and scoped to these ids so the read
        // stays small however long the history gets.
        const { data: ratedRows, error: feedbackError } = await supabase
          .from('feedback')
          .select('trip_id')
          .in('trip_id', trips.map((t) => t.id));

        if (feedbackError) throw feedbackError;

        const rated = new Set((ratedRows ?? []).map((r: { trip_id: string }) => r.trip_id));
        // Ordered newest-first above, so the first unrated row is the most
        // recent one.
        const candidate = trips.find((t) => !rated.has(t.id));
        if (!candidate) return;

        if (mountedRef.current) {
          setYesterdayTrip({
            tripId: candidate.id,
            originLabel: candidate.origin_label ?? 'Unknown origin',
            destinationLabel: candidate.destination_label ?? 'Unknown destination',
            recommendedLeaveTime: candidate.recommended_leave_time,
            createdAt: candidate.created_at,
          });
        }
      } catch (err) {
        devLog('load', err);
      } finally {
        if (mountedRef.current) setLoaded(true);
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { yesterdayTrip, loaded };
}
