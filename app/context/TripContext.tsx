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

export interface PlanPrefill {
  originLabel: string;
  originLat: number;
  originLng: number;
  destLabel: string;
  destLat: number;
  destLng: number;
  planningMode: 'arrive_by' | 'leave_at';
}

export interface PendingFeedback {
  tripId: string;
  destLabel: string;
}

interface TripContextValue {
  currentTrip: TripResult | null;
  currentMeta: TripMeta | null;
  setCurrentTrip: (trip: TripResult | null, meta: TripMeta | null) => void;
  prefillData: PlanPrefill | null;
  setPrefillData: (data: PlanPrefill | null) => void;
  pendingFeedback: PendingFeedback | null;
  setPendingFeedback: (feedback: PendingFeedback | null) => void;
}

const TripContext = createContext<TripContextValue>({
  currentTrip: null,
  currentMeta: null,
  setCurrentTrip: () => {},
  prefillData: null,
  setPrefillData: () => {},
  pendingFeedback: null,
  setPendingFeedback: () => {},
});

export function TripProvider({ children }: { children: ReactNode }) {
  const [currentTrip, setTrip] = useState<TripResult | null>(null);
  const [currentMeta, setMeta] = useState<TripMeta | null>(null);
  const [prefillData, setPrefill] = useState<PlanPrefill | null>(null);
  const [pendingFeedback, setPendingFeedbackState] = useState<PendingFeedback | null>(null);

  function setCurrentTrip(trip: TripResult | null, meta: TripMeta | null) {
    setTrip(trip);
    setMeta(meta);
  }

  function setPrefillData(data: PlanPrefill | null) {
    setPrefill(data);
  }

  function setPendingFeedback(feedback: PendingFeedback | null) {
    setPendingFeedbackState(feedback);
  }

  return (
    <TripContext.Provider value={{
      currentTrip,
      currentMeta,
      setCurrentTrip,
      prefillData,
      setPrefillData,
      pendingFeedback,
      setPendingFeedback,
    }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTripContext() {
  return useContext(TripContext);
}
