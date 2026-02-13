
export enum AppState {
  IDLE = 'IDLE',
  STANDBY = 'STANDBY',
  LISTENING = 'LISTENING',
  THINKING = 'THINKING',
  SPEAKING = 'SPEAKING',
  GUIDANCE = 'GUIDANCE',
  EMERGENCY = 'EMERGENCY'
}

export interface DetectedObject {
  label: string;
  distance: number;
  position: string;
}

export interface VisionResult {
  description: string;
  objects: DetectedObject[];
  text?: string;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  address?: string;
}
