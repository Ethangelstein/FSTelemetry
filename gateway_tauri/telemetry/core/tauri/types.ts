export type Telemetry = {
  version: number
  reserved: number
  timestamp: number
  latitude: number
  longitude: number
  altitude: number
  rpm: number
  ax: number
  ay: number
  az: number
  voltage_mv: number
  current_ma: number
  rssi: number
  snr: number
  packet_count: number
}

export type FrameEv = {hex: string; okCrc: boolean}

export const EV = {
  SerialOpen: "serial:open",
  SerialError: "serial:error",
  SerialFrame: "serial:frame",
  Telemetry: "telemetry"
} as const

export const isTauri = typeof window !== "undefined" && (window as any).__TAURI__ !== undefined
