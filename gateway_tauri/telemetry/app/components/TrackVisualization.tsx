import {useState, useEffect} from "react"

interface GPSCoordinate {
  lat: number
  lon: number
  alt: number
}

interface TrackPoint {
  x: number
  y: number
}

interface TrackVisualizationProps {
  currentGPS: GPSCoordinate
  speed: number
  className?: string
}

// Sample track coordinates (Buenos Aires street circuit example)
// In real implementation, you'd load this from your actual track data
const TRACK_BOUNDS = {
  north: -34.602, // Northern boundary
  south: -34.606, // Southern boundary
  east: -58.38, // Eastern boundary
  west: -58.385 // Western boundary
}

// Using actual circuit.svg instead of hardcoded path
// Removed TRACK_PATH constant as we now use the circuit.svg file

// Track sectors removed - not defined yet for this circuit

// Removed DRS zones as they're not applicable to karting

// Convert GPS coordinates to SVG coordinates
// Updated for larger circuit viewBox
function gpsToSVG(gps: GPSCoordinate, svgWidth: number = 800, svgHeight: number = 600): TrackPoint {
  // Normalize GPS coordinates to 0-1 range
  const normalizedX = (gps.lon - TRACK_BOUNDS.west) / (TRACK_BOUNDS.east - TRACK_BOUNDS.west)
  const normalizedY = (TRACK_BOUNDS.north - gps.lat) / (TRACK_BOUNDS.north - TRACK_BOUNDS.south)

  // Convert to SVG coordinates with padding
  const padding = 50
  return {
    x: padding + normalizedX * (svgWidth - 2 * padding),
    y: padding + normalizedY * (svgHeight - 2 * padding)
  }
}

// Get speed color based on velocity
function getSpeedColor(speed: number): string {
  if (speed > 80) return "#EF4444" // Red - Very fast
  if (speed > 60) return "#F59E0B" // Orange - Fast
  if (speed > 40) return "#10B981" // Green - Medium
  if (speed > 20) return "#06B6D4" // Cyan - Slow
  return "#6B7280" // Gray - Very slow/stopped
}

// Sector calculation removed - sectors not defined yet

export default function TrackVisualization({currentGPS, speed, className = ""}: TrackVisualizationProps) {
  const [carPosition, setCarPosition] = useState<TrackPoint>({x: 400, y: 300})
  const [trackHistory, setTrackHistory] = useState<TrackPoint[]>([])

  useEffect(() => {
    const newPosition = gpsToSVG(currentGPS)
    setCarPosition(newPosition)

    // Add to track history (keep last 50 points)
    setTrackHistory(prev => {
      const newHistory = [...prev, newPosition]
      return newHistory.slice(-50)
    })
  }, [currentGPS])

  return (
    <div className={`bg-black border-2 border-cyan-400 p-4 font-mono ${className}`}>
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-4">TRACK POSITION</div>

      {/* Track SVG */}
      <div className="relative mb-4 overflow-hidden">
        <svg width="100%" height="400" viewBox="0 0 800 600" className="border border-gray-600">
          {/* Track background - transparent for clean look */}

          {/* Circuit SVG as background */}
          <image href="/track.svg" width="800" height="600" opacity="0.8" preserveAspectRatio="xMidYMid meet" />

          {/* DRS Zones removed - not applicable to karting */}

          {/* Track history (racing line) */}
          {trackHistory.length > 1 && (
            <path
              d={`M ${trackHistory.map(p => `${p.x} ${p.y}`).join(" L ")}`}
              fill="none"
              stroke="#06B6D4"
              strokeWidth="3"
              opacity="0.8"
            />
          )}

          {/* Car position */}
          <g>
            {/* Car wake/trail effect */}
            <circle
              cx={carPosition.x}
              cy={carPosition.y}
              r="12"
              fill={getSpeedColor(speed)}
              opacity="0.3"
              className="animate-pulse"
            />

            {/* Main car dot */}
            <circle
              cx={carPosition.x}
              cy={carPosition.y}
              r="6"
              fill={getSpeedColor(speed)}
              stroke="#ffffff"
              strokeWidth="2"
            />

            {/* Speed indicator ring */}
            <circle
              cx={carPosition.x}
              cy={carPosition.y}
              r="9"
              fill="none"
              stroke={getSpeedColor(speed)}
              strokeWidth="1.5"
              opacity="0.8"
            />
          </g>

          {/* Sector markers removed - not defined yet */}

          {/* Track boundaries */}
          <rect
            width="800"
            height="600"
            fill="none"
            stroke="#cyan"
            strokeWidth="1"
            strokeDasharray="3,3"
            opacity="0.3"
          />
        </svg>
      </div>

      {/* Track information panel */}
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="text-center">
          <div className="text-gray-400">SPEED</div>
          <div className="text-lg font-bold" style={{color: getSpeedColor(speed)}}>
            {speed.toFixed(0)} km/h
          </div>
        </div>

        <div className="text-center">
          <div className="text-gray-400">POSITION</div>
          <div className="text-cyan-400 text-xs">
            {carPosition.x.toFixed(0)},{carPosition.y.toFixed(0)}
          </div>
        </div>
      </div>

      {/* GPS coordinates display */}
      <div className="mt-3 pt-2 border-t border-gray-600 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-400">LAT:</span>
            <span className="text-cyan-400 ml-1">{currentGPS.lat.toFixed(6)}</span>
          </div>
          <div>
            <span className="text-gray-400">LON:</span>
            <span className="text-cyan-400 ml-1">{currentGPS.lon.toFixed(6)}</span>
          </div>
        </div>
      </div>

      {/* Track legend */}
      <div className="mt-3 pt-2 border-t border-gray-600 text-xs">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-1 bg-cyan-400"></div>
            <span className="text-gray-400">Racing Line</span>
          </div>
          <div className="text-gray-400">Live Karting Track</div>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full" style={{backgroundColor: "var(--speed-color, #06B6D4)"}}></div>
            <span className="text-gray-400">Kart Position</span>
          </div>
        </div>
      </div>
    </div>
  )
}
