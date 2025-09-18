import {NextRequest, NextResponse} from "next/server"

// Interface for the compressed LoRa data format
interface CompressedTelemetryData {
  id: string
  t: number
  g: [number, number, number] // [lat, lon, alt]
  r: number
  a: [number, number, number] // [x, y, z]
  v: number
  c: number
  lapTime?: number
}

// Interface for the expanded telemetry data
interface ExpandedTelemetryData {
  device_id: string
  timestamp: string
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

// Transform compressed data to expanded format
function transformTelemetryData(compressed: CompressedTelemetryData): ExpandedTelemetryData {
  return {
    device_id: compressed.id,
    timestamp: new Date(compressed.t * 1000).toISOString(),
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

// Store telemetry data in memory (in production, use a database)
let latestTelemetryData: ExpandedTelemetryData | null = null
let telemetryHistory: ExpandedTelemetryData[] = []
let lapTimes: {lap: number; time: number}[] = []


const MAX_HISTORY_SIZE = 100

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate the incoming data structure
    if (!body.id || typeof body.t !== "number" || !Array.isArray(body.g) || body.g.length !== 3) {
      return NextResponse.json({error: "Invalid telemetry data format"}, {status: 400})
    }

    const compressedData: CompressedTelemetryData = body

    // Handle lap time data if present
    if (compressedData.lapTime) {
      lapTimes.push({lap: lapTimes.length + 1, time: compressedData.lapTime})
    }

    // Transform to expanded format
    const expandedData = transformTelemetryData(compressedData)

    // Store the latest data
    latestTelemetryData = expandedData
    telemetryHistory.push(expandedData)
    if (telemetryHistory.length > 300) {
      // Keep last 5 minutes at 1Hz
      telemetryHistory.shift()
    }

    console.log(
      `Received telemetry data from device: ${expandedData.device_id} at ${expandedData.timestamp}`
    )

    return NextResponse.json(
      {
        message: "Telemetry data received successfully",
        device_id: expandedData.device_id,
        timestamp: expandedData.timestamp
      },
      {status: 200}
    )
  } catch (error) {
    console.error("Error processing telemetry data:", error)
    return NextResponse.json({error: "Failed to process telemetry data"}, {status: 500})
  }
}

export async function GET(request: NextRequest) {
  try {
    const {searchParams} = new URL(request.url)
    const getSession = searchParams.get("session") === "true"

    if (getSession) {
      return NextResponse.json({
        lapTimes: lapTimes,
        telemetryHistory: telemetryHistory
      })
    }

    if (!latestTelemetryData) {
      return NextResponse.json(
        {
          message: "No telemetry data available"
        },
        {status: 404}
      )
    }

    return NextResponse.json({
      data: latestTelemetryData,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error("Error retrieving telemetry data:", error)
    return NextResponse.json({error: "Failed to retrieve telemetry data"}, {status: 500})
  }
}

