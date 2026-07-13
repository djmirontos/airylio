import { createContext, useContext, useState, ReactNode } from 'react';

export interface TripResult {
  tripId: string;
  recommendedLeaveTime: string;
  predictedArrivalTime: string;
  confidenceScore: number;
  confidenceReason: string[];
  dataFreshness: string;
  distanceMeters?: number;
  weatherCondition?: 'clear' | 'rain' | 'heavy_rain' | 'storm';
  encodedPolyline?: string;
  recommendationExplanation?: {
    planningMode?: 'arrive_by' | 'leave_at';
    factors: any[];
  };
}

export interface TripMeta {
  originLabel: string;
  destLabel: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  selectedDateTime: Date;
  planningMode: 'arrive_by' | 'leave_at';
}

interface TripContextValue {
  currentTrip: TripResult | null;
  currentMeta: TripMeta | null;
  setCurrentTrip: (trip: TripResult | null, meta: TripMeta | null) => void;
}

const TripContext = createContext<TripContextValue>({
  currentTrip: null,
  currentMeta: null,
  setCurrentTrip: () => {},
});

export function TripProvider({ children }: { children: ReactNode }) {
  const [currentTrip, setTrip] = useState<TripResult | null>(null);
  const [currentMeta, setMeta] = useState<TripMeta | null>(null);

  function setCurrentTrip(trip: TripResult | null, meta: TripMeta | null) {
    setTrip(trip);
    setMeta(meta);
  }

  return (
    <TripContext.Provider value={{ currentTrip, currentMeta, setCurrentTrip }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTripContext() {
  return useContext(TripContext);
}
