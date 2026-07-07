export interface CityBoundary {
  cityCode: string;
  launchPriority: number;
  boundary: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}
