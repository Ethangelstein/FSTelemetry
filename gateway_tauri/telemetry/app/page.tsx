"use client"

import {useState, useEffect, useCallback} from "react"
import TrackVisualization from "./components/TrackVisualization"
import LapTimeChart from "./components/charts/LapTimeChart"
import BatteryChart from "./components/charts/BatteryChart"
import {useTauri} from "@/core/tauri/TauriProvider"

// Type definitions for telemetry data
interface CompressedTelemetryData {
  id: string
  t: number
  g: [number, number, number] // [lat, lon, alt]
  r: number
  a: [number, number, number] // [x, y, z]
  v: number
  c: number
}

interface ExpandedTelemetryData {
  device_id: string
  timestamp: number
  gps: {
    lat: number
    lon: number
    alt: number
    fix: boolean
  }
  rpm: number
  accel_raw: {
    x: number
    y: number
    z: number
  }
  voltage_mv: number
  current_ma: number
}

interface ProcessedTelemetryData extends ExpandedTelemetryData {
  calculated: {
    speed_estimate_kmh: number
    g_force_lateral: number
    g_force_longitudinal: number
    g_force_vertical: number
    g_force_total: number
    power_consumption_w: number
    battery_percentage: number
    efficiency_wh_km: number
    temperature_estimate_c: number
  }
}

// Transform compressed data to expanded format
function transformTelemetryData(compressed: CompressedTelemetryData): ExpandedTelemetryData {
  return {
    device_id: compressed.id,
    timestamp: compressed.t * 1000,
    gps: {
      lat: compressed.g[0],
      lon: compressed.g[1],
      alt: compressed.g[2],
      fix: true
    },
    rpm: compressed.r,
    accel_raw: {
      x: compressed.a[0],
      y: compressed.a[1],
      z: compressed.a[2]
    },
    voltage_mv: compressed.v,
    current_ma: compressed.c
  }
}

// Process telemetry data to calculate derived metrics
function processTelemeryData(data: ExpandedTelemetryData): ProcessedTelemetryData {
  // Convert accelerometer readings from mg to g-force
  const g_force_lateral = data.accel_raw.x / 1000
  const g_force_longitudinal = data.accel_raw.y / 1000
  const g_force_vertical = (data.accel_raw.z - 1000) / 1000 // Subtract 1g for gravity
  const g_force_total = Math.sqrt(g_force_lateral ** 2 + g_force_longitudinal ** 2 + g_force_vertical ** 2)

  // Estimate speed from RPM (assuming wheel circumference)
  const wheel_circumference_m = 1.823 // 58 cm diameter wheel (π·d)
  const speed_estimate_kmh = (data.rpm * wheel_circumference_m * 60) / 1000

  // Power calculations
  const voltage_v = data.voltage_mv / 1000
  const current_a = data.current_ma / 1000
  const power_consumption_w = voltage_v * current_a

  // Battery estimation for 48 V pack (40 V empty, 48 V full)
  const battery_percentage = Math.max(0, Math.min(100, ((voltage_v - 40) / (48 - 40)) * 100))

  // Efficiency calculation (Wh/km)
  const efficiency_wh_km = speed_estimate_kmh > 0 ? power_consumption_w / speed_estimate_kmh : 0

  // Temperature estimate: 25 °C base, rises with current draw, capped at 55 °C
  let temperature_estimate_c = 25 + data.current_ma * 0.0018
  temperature_estimate_c = Math.min(55, Math.max(25, temperature_estimate_c))

  return {
    ...data,
    calculated: {
      speed_estimate_kmh,
      g_force_lateral,
      g_force_longitudinal,
      g_force_vertical,
      g_force_total,
      power_consumption_w,
      battery_percentage,
      efficiency_wh_km,
      temperature_estimate_c
    }
  }
}

// F1-style metric card component
function MetricCard({
  label,
  value,
  unit,
  status = "normal",
  className = ""
}: {
  label: string
  value: string | number
  unit?: string
  status?: "normal" | "warning" | "critical" | "optimal"
  className?: string
}) {
  const statusColors = {
    normal: "text-blue-400 border-blue-400",
    warning: "text-yellow-400 border-yellow-400",
    critical: "text-red-400 border-red-400",
    optimal: "text-green-400 border-green-400"
  }

  return (
    <div className={`bg-black border-2 ${statusColors[status]} p-4 font-mono ${className}`}>
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold">
        {typeof value === "number" ? value.toFixed(2) : value}
        {unit && <span className="text-sm text-gray-400 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

// Large display component for key metrics
function PrimaryMetric({
  label,
  value,
  unit,
  status = "normal"
}: {
  label: string
  value: number
  unit: string
  status?: "normal" | "warning" | "critical" | "optimal"
}) {
  const statusColors = {
    normal: "text-blue-400 border-blue-400",
    warning: "text-yellow-400 border-yellow-400",
    critical: "text-red-400 border-red-400",
    optimal: "text-green-400 border-green-400"
  }

  return (
    <div className={`bg-black border-4 ${statusColors[status]} p-6 text-center font-mono`}>
      <div className="text-sm text-gray-400 uppercase tracking-wide mb-2">{label}</div>
      <div className="text-6xl font-bold mb-2">{value.toFixed(1)}</div>
      <div className="text-lg text-gray-400">{unit}</div>
    </div>
  )
}

// G-Force visualization component
function GForceDisplay({calculated}: {calculated: ProcessedTelemetryData["calculated"]}) {
  const maxG = 3
  const lateralPercent = Math.min(100, (Math.abs(calculated.g_force_lateral) / maxG) * 100)
  const longitudinalPercent = Math.min(100, (Math.abs(calculated.g_force_longitudinal) / maxG) * 100)

  return (
    <div className="bg-black border-2 border-purple-400 p-4 font-mono">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-4">G-FORCE ANALYSIS</div>

      {/* G-Force Circle */}
      <div className="relative w-32 h-32 mx-auto mb-4">
        <div className="absolute inset-0 border-2 border-gray-600 rounded-full"></div>
        <div className="absolute inset-2 border border-gray-700 rounded-full"></div>
        <div className="absolute inset-4 border border-gray-800 rounded-full"></div>

        {/* G-Force Dot */}
        <div
          className="absolute w-3 h-3 bg-purple-400 rounded-full transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${50 + (calculated.g_force_lateral / maxG) * 40}%`,
            top: `${50 - (calculated.g_force_longitudinal / maxG) * 40}%`
          }}
        ></div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          LAT: <span className="text-purple-400">{calculated.g_force_lateral.toFixed(2)}g</span>
        </div>
        <div>
          LON: <span className="text-purple-400">{calculated.g_force_longitudinal.toFixed(2)}g</span>
        </div>
        <div>
          VER: <span className="text-purple-400">{calculated.g_force_vertical.toFixed(2)}g</span>
        </div>
        <div>
          TOT: <span className="text-purple-400">{calculated.g_force_total.toFixed(2)}g</span>
        </div>
      </div>
    </div>
  )
}

// Battery status component
function BatteryStatus({
  calculated,
  voltage_mv
}: {
  calculated: ProcessedTelemetryData["calculated"]
  voltage_mv: number
}) {
  const voltage_v = voltage_mv / 1000
  const percentage = calculated.battery_percentage

  let status: "optimal" | "normal" | "warning" | "critical" = "normal"
  if (percentage > 80) status = "optimal"
  else if (percentage > 50) status = "normal"
  else if (percentage > 20) status = "warning"
  else status = "critical"

  return (
    <div className="bg-black border-2 border-green-400 p-4 font-mono">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">POWER SYSTEM</div>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span>BATTERY</span>
          <span className="text-green-400">{percentage.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-800 h-2">
          <div
            className={`h-2 ${percentage > 20 ? "bg-green-400" : "bg-red-400"}`}
            style={{width: `${percentage}%`}}
          ></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          VOLT: <span className="text-green-400">{voltage_v.toFixed(2)}V</span>
        </div>
        <div>
          CURR: <span className="text-green-400">{(calculated.power_consumption_w / voltage_v).toFixed(1)}A</span>
        </div>
        <div>
          PWR: <span className="text-green-400">{calculated.power_consumption_w.toFixed(1)}W</span>
        </div>
        <div>
          TEMP: <span className="text-green-400">{calculated.temperature_estimate_c.toFixed(0)}°C</span>
        </div>
      </div>
    </div>
  )
}

export default function TelemetryDashboard() {
  const t = useTauri()
  const [telemetryData, setTelemetryData] = useState<ProcessedTelemetryData | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sessionData, setSessionData] = useState<{
    processedTelemetry: ProcessedTelemetryData[]
    telemetryHistory: {timestamp: number; voltage_mv: number; current_ma: number}[]
    lapHistory: {lap: number; time: number}[]
  }>({
    processedTelemetry: [],
    telemetryHistory: [],
    lapHistory: []
  })
  const [technicianMode, setTechnicianMode] = useState(false)

  useEffect(() => {
    if (!t.isTauri || t.open || !t.ports.length) return
    t.openPort(t.ports[0]).catch(console.error)
  }, [t.isTauri, t.ports, t.open])

  useEffect(() => {
    if (!t.expanded) return
    const processed = processTelemeryData(t.expanded)
    setTelemetryData(processed)
    setLastUpdated(new Date())
  }, [t.expanded])


  // Connection status is now managed by Socket.IO hook
  // No need for manual connection checking

  if (!telemetryData) {
    return (
      <div className="min-h-screen bg-black text-green-400 flex items-center justify-center font-mono">
        <div className="text-center border-2 border-green-400 p-8">
          <div className="animate-pulse text-4xl mb-4">◉ TELEMETRY SYSTEM</div>
          <div className="text-sm mb-2">AWAITING SIGNAL...</div>
        </div>
      </div>
    )
  }

  const getSpeedStatus = (speed: number) => {
    if (speed > 42) return "critical"
    if (speed > 35) return "warning"
    if (speed > 15) return "optimal"
    return "normal"
  }

  const getRpmStatus = (rpm: number) => {
    if (rpm > 1800) return "critical"
    if (rpm > 1600) return "warning"
    if (rpm > 1000) return "optimal"
    return "normal"
  }

  function formatLapTime(ms: number): string {
    if (!ms || ms === 0) return "--:--.-"
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    const millis = Math.floor((ms % 1000) / 10)
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(2, "0")}`
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 font-mono">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* --- LEFT COLUMN: Strategy & Timing --- */}
        <div className="lg:col-span-1 space-y-6">
          {/* Header */}
          <div className="border-b-2 border-gray-600 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <h1 className="text-3xl font-bold text-blue-400">TELEMETRY</h1>
                <div className="flex items-center space-x-2 px-4 py-2 border-2 border-green-400 text-green-400">
                  <div className="w-3 h-3 bg-green-400 animate-pulse"></div>
                  <span className="text-sm font-bold">SYSTEM ACTIVE</span>
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center space-x-6 text-sm text-gray-400">
              <span>
                UNIT: <span className="text-blue-400">{telemetryData.device_id}</span>
              </span>
              <span>
                TIME: <span className="text-blue-400">{lastUpdated?.toLocaleTimeString()}</span>
              </span>
              <span>
                SESSION: <span className="text-blue-400">LIVE</span>
              </span>
            </div>
          </div>

          {/* Lap Analysis */}
          <div className="bg-black border-2 border-orange-400 p-4 font-mono">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-4">LAP ANALYSIS</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>LAP:</span>
                <span className="text-orange-400">--</span>
              </div>
              <div className="flex justify-between">
                <span>BEST:</span>
                <span className="text-orange-400">
                  {sessionData.lapHistory.length > 0
                    ? formatLapTime(Math.min(...sessionData.lapHistory.map(l => l.time)))
                    : "--:--.-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>LAST:</span>
                <span className="text-orange-400">
                  {sessionData.lapHistory.length > 0
                    ? formatLapTime(sessionData.lapHistory[sessionData.lapHistory.length - 1].time)
                    : "--:--.-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>DELTA:</span>
                <span className="text-orange-400">--.-</span>
              </div>
            </div>
          </div>
          <LapTimeChart data={sessionData.lapHistory} />

          {/* Performance */}
          <div className="bg-black border-2 border-pink-400 p-4 font-mono">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-4">PERFORMANCE</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>AVG SPEED:</span>
                <span className="text-pink-400">{telemetryData.calculated.speed_estimate_kmh.toFixed(0)} KM/H</span>
              </div>
              <div className="flex justify-between">
                <span>MAX G:</span>
                <span className="text-pink-400">{telemetryData.calculated.g_force_total.toFixed(1)}g</span>
              </div>
              <div className="flex justify-between">
                <span>RANGE:</span>
                <span className="text-pink-400">{(telemetryData.calculated.battery_percentage * 2).toFixed(0)} KM</span>
              </div>
              <div className="flex justify-between">
                <span>MODE:</span>
                <span className="text-pink-400">RACE</span>
              </div>
            </div>
          </div>
        </div>

        {/* --- CENTER COLUMN: Driver & Vitals --- */}
        <div className="lg:col-span-2 space-y-6">
          {/* Primary Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <PrimaryMetric
              label="SPEED"
              value={telemetryData.calculated.speed_estimate_kmh}
              unit="KM/H"
              status={getSpeedStatus(telemetryData.calculated.speed_estimate_kmh)}
            />
            <PrimaryMetric
              label="RPM"
              value={telemetryData.rpm}
              unit="REV/MIN"
              status={getRpmStatus(telemetryData.rpm)}
            />
            <PrimaryMetric
              label="POWER"
              value={telemetryData.calculated.power_consumption_w}
              unit="WATTS"
              status={telemetryData.calculated.power_consumption_w > 2000 ? "warning" : "normal"}
            />
          </div>

          {/* Track Visualization */}
          <TrackVisualization currentGPS={telemetryData.gps} speed={telemetryData.calculated.speed_estimate_kmh} />

          {/* G-Force Display */}
          <GForceDisplay calculated={telemetryData.calculated} />
        </div>

        {/* --- RIGHT COLUMN: Systems & Health --- */}
        <div className="lg:col-span-1 space-y-6">
          {/* Tech Mode Toggle */}
          <button
            onClick={() => setTechnicianMode(!technicianMode)}
            className={`w-full px-4 py-2 border-2 text-sm font-bold ${
              technicianMode ? "border-yellow-400 text-yellow-400 bg-yellow-900/20" : "border-gray-400 text-gray-400"
            }`}
          >
            TECH MODE {technicianMode ? "ON" : "OFF"}
          </button>

          {/* Battery Status */}
          <BatteryStatus calculated={telemetryData.calculated} voltage_mv={telemetryData.voltage_mv} />
          <BatteryChart data={sessionData.telemetryHistory} />

          {/* GPS Status */}
          <div className="bg-black border-2 border-cyan-400 p-4 font-mono">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-4">GPS STATUS</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>LAT:</span>
                <span className="text-cyan-400">{telemetryData.gps.lat.toFixed(4)}°</span>
              </div>
              <div className="flex justify-between">
                <span>LON:</span>
                <span className="text-cyan-400">{telemetryData.gps.lon.toFixed(4)}°</span>
              </div>
              <div className="flex justify-between">
                <span>ALT:</span>
                <span className="text-cyan-400">{telemetryData.gps.alt.toFixed(1)}m</span>
              </div>
              <div className="flex justify-between">
                <span>FIX:</span>
                <span className="text-cyan-400">{telemetryData.gps.fix ? "LOCKED" : "SEARCHING"}</span>
              </div>
            </div>
          </div>

          {/* Secondary Metrics */}
          <div className="bg-black border-2 border-gray-600 p-4 font-mono">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-4">SYSTEMS CHECK</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <MetricCard
                label="TEMP"
                value={telemetryData.calculated.temperature_estimate_c.toFixed(0)}
                unit="°C"
                className="!p-2 !border-0"
              />
              <MetricCard
                label="EFF."
                value={telemetryData.calculated.efficiency_wh_km.toFixed(1)}
                unit="Wh/km"
                className="!p-2 !border-0"
              />
            </div>
          </div>

          {/* Technician Mode - Raw Data */}
          {technicianMode && (
            <div className="border-2 border-yellow-400 p-4">
              <div className="text-yellow-400 text-sm font-bold mb-4 uppercase">⚠️ TECHNICIAN MODE - RAW DATA</div>
              <pre className="bg-gray-900 border border-gray-600 p-3 text-xs overflow-x-auto text-green-400">
                {JSON.stringify(telemetryData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
