// telemetry/core/tauri/useTauriSerial.ts
"use client"
import {useEffect, useMemo, useRef, useState} from "react"
import {TauriBridge} from "./bridge"
import {isTauri} from "./types"

// Copiá o importá tu tipo:
export type ExpandedTelemetryData = {
  device_id: string
  timestamp: number
  gps: {lat: number; lon: number; alt: number; fix: boolean}
  rpm: number
  accel_raw: {x: number; y: number; z: number}
  voltage_mv: number
  current_ma: number
}

// El payload que manda Rust:
type TauriTelemetry = {
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

function tauriToExpanded(t: TauriTelemetry): ExpandedTelemetryData {
  return {
    device_id: "tauri-device",
    timestamp: t.timestamp * 1000,
    gps: {lat: t.latitude, lon: t.longitude, alt: t.altitude, fix: true},
    rpm: t.rpm,
    accel_raw: {x: t.ax, y: t.ay, z: t.az},
    voltage_mv: t.voltage_mv,
    current_ma: t.current_ma
  }
}

export function useTauriSerial() {
  const [ports, setPorts] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const framesRef = useRef<string[]>([])
  const [expanded, setExpanded] = useState<ExpandedTelemetryData | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!isTauri) return
    TauriBridge.listPorts().then(setPorts)
    const subs: Array<() => void> = []
    ;(async () => {
      const u1 = await TauriBridge.onTelemetry(t => {
        const e = tauriToExpanded(t as any)
        setExpanded(e)
      })
      const u2 = await TauriBridge.onFrame(f => {
        framesRef.current = [...framesRef.current.slice(-200), `${f.okCrc ? "✓" : "×"} ${f.hex}`]
      })
      const u3 = await TauriBridge.onError(m => setErrors(e => [...e, m]))
      ;[u1, u2, u3].forEach(u => u && subs.push(u))
    })()
    return () => subs.forEach(u => u && u())
  }, [])

  const api = useMemo(
    () => ({
      isTauri,
      ports,
      open,
      expanded,
      frames: framesRef.current,
      errors,
      async openPort(
        portName: string,
        opts?: {baud?: number; magic?: [number, number]; frameSize?: number; useCrc?: boolean}
      ) {
        await TauriBridge.open({
          portName,
          baud: opts?.baud ?? 115200,
          magic0: opts?.magic?.[0] ?? "T".charCodeAt(0),
          magic1: opts?.magic?.[1] ?? "D".charCodeAt(0),
          frameSize: opts?.frameSize ?? 60,
          useCrc: opts?.useCrc ?? true
        })
        setOpen(true)
      },
      async writeHex(hex: string) {
        await TauriBridge.writeHex(hex)
      },
      async close() {
        await TauriBridge.close()
        setOpen(false)
      },
      refreshPorts: () => TauriBridge.listPorts().then(setPorts)
    }),
    [ports, open, expanded, errors]
  )

  return api
}
