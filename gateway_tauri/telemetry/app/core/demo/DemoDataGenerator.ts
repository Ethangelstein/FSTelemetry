export interface CompressedTelemetryData {
  id: string
  t: number
  g: [number, number, number] // [lat, lon, alt]
  r: number
  a: [number, number, number] // [x, y, z]
  v: number
  c: number
}

export interface DemoConfig {
  scenario: "practice" | "qualifying" | "race" | "incident" | "battery_test"
  speedMultiplier: number
  trackId: string
  startPosition: number // 0-1 around track
}

export interface TrackPosition {
  lat: number
  lon: number
  alt: number
  progress: number // 0-1 around track
  sector: number // 1, 2, or 3
  speed: number
  banking: number
}

export class DemoDataGenerator {
  private config: DemoConfig
  private startTime: number
  private currentLap: number = 0
  private currentProgress: number = 0
  private currentSpeed: number = 0
  private lapStartTime: number = 0
  private lastLapTime: number = 0
  private bestLapTime: number = 0
  private justCompletedLap: number | undefined = undefined
  private lapTimes: {lap: number; time: number}[] = []
  private sectorTimes: number[] = []
  private batteryCapacity: number = 100
  private totalDistance: number = 0
  private lastVoltageMv: number = 48000

  // Buenos Aires circuit bounds and characteristics
  private readonly TRACK_BOUNDS = {
    north: -34.602,
    south: -34.606,
    east: -58.38,
    west: -58.385,
    circumference: 3.2 // km
  }

  // Track profile - speed zones and characteristics
  private readonly TRACK_PROFILE = [
    {progress: 0.0, targetSpeed: 40, banking: 0, sector: 1}, // Start/Finish straight
    {progress: 0.1, targetSpeed: 28, banking: -2, sector: 1}, // Turn 1 complex
    {progress: 0.2, targetSpeed: 34, banking: 0, sector: 1}, // Sector 1 middle
    {progress: 0.33, targetSpeed: 32, banking: 1, sector: 2}, // Sector 1-2 transition
    {progress: 0.45, targetSpeed: 38, banking: 0, sector: 2}, // Back straight start
    {progress: 0.55, targetSpeed: 45, banking: 0, sector: 2}, // Back straight end (maximum)
    {progress: 0.66, targetSpeed: 26, banking: -3, sector: 3}, // Hairpin section
    {progress: 0.75, targetSpeed: 32, banking: 1, sector: 3}, // Technical section
    {progress: 0.85, targetSpeed: 36, banking: 0, sector: 3}, // Final sector
    {progress: 0.95, targetSpeed: 40, banking: 0, sector: 3} // Approach to straight
  ]

  constructor(config: DemoConfig) {
    this.config = config
    this.startTime = Date.now()
    this.currentProgress = config.startPosition
    this.lapStartTime = this.startTime

    // Set initial lap parameters based on scenario
    this.initializeScenario()

    // Set initial voltage based on starting battery capacity
    this.lastVoltageMv = 40000 + (this.batteryCapacity / 100) * 8000
  }

  private initializeScenario(): void {
    switch (this.config.scenario) {
      case "practice":
        this.bestLapTime = 95000 // 1:35.000
        this.batteryCapacity = 85
        break
      case "qualifying":
        this.bestLapTime = 92000 // 1:32.000 (faster)
        this.batteryCapacity = 95
        break
      case "race":
        this.bestLapTime = 94000 // 1:34.000 (conservative)
        this.batteryCapacity = 100
        break
      case "incident":
        this.bestLapTime = 98000 // 1:38.000 (recovery)
        this.batteryCapacity = 70
        break
      case "battery_test":
        this.bestLapTime = 96000 // 1:36.000 (efficiency focus)
        this.batteryCapacity = 60
        break
    }
  }

  public generateTelemetryData(): CompressedTelemetryData {
    const now = Date.now()
    const elapsed = (now - this.startTime) * this.config.speedMultiplier

    // Update position and lap progress
    this.updatePosition(elapsed)

    // Get current track position
    const trackPos = this.getTrackPosition()

    // Generate physics data
    const rpm = this.calculateRPM(trackPos)
    const acceleration = this.calculateAcceleration(trackPos)
    const power = this.calculatePower(trackPos)

    const newLapPayload: any = {}
    if (this.justCompletedLap) {
      newLapPayload.lapTime = this.justCompletedLap
      this.justCompletedLap = undefined
    }

    // Gradual battery drain proportional to power draw and speed
    const baseDrain = 0.0025 // ~0.0167% per second at 30 km/h (10 Hz)
    const speedRatio = trackPos.speed / 45 // 0-1 scale relative to max kart speed

    // Scenario multipliers – higher load in qualifying, lower in efficiency modes
    let scenarioMultiplier = 1
    switch (this.config.scenario) {
      case "qualifying":
        scenarioMultiplier = 1.15 // push harder
        break
      case "race":
        scenarioMultiplier = 1.0
        break
      case "practice":
        scenarioMultiplier = 0.9
        break
      case "battery_test":
        scenarioMultiplier = 0.75
        break
      case "incident":
        scenarioMultiplier = 0.6
        break
    }

    const drain = baseDrain * speedRatio * scenarioMultiplier
    this.batteryCapacity = Math.max(0, this.batteryCapacity - drain)

    return {
      id: `demo_${this.config.scenario}`,
      t: Math.floor(now / 1000),
      g: [trackPos.lat, trackPos.lon, trackPos.alt],
      r: rpm,
      a: acceleration,
      v: power.voltage,
      c: power.current,
      ...newLapPayload
    }
  }

  private updatePosition(elapsed: number): void {
    // Calculate speed progression based on track profile and scenario
    const targetPos = this.getTrackPosition()
    const targetSpeed = this.getTargetSpeed(targetPos)

    // Smooth speed transitions
    const speedDiff = targetSpeed - this.currentSpeed
    const maxAcceleration = this.getMaxAcceleration()
    const speedChange = Math.sign(speedDiff) * Math.min(Math.abs(speedDiff), maxAcceleration * 0.1)
    this.currentSpeed = Math.max(0, this.currentSpeed + speedChange)

    // Update track progress based on speed
    const distancePerMs = this.currentSpeed / 3.6 / 1000 // km/h to m/ms
    const progressPerMs = distancePerMs / (this.TRACK_BOUNDS.circumference * 1000)
    this.currentProgress += progressPerMs * 16.67 // ~60fps simulation

    // Handle lap completion
    if (this.currentProgress >= 1.0) {
      this.completeLap(elapsed)
      this.currentProgress = this.currentProgress - 1.0
    }

    // Update total distance
    this.totalDistance += distancePerMs * 16.67
  }

  private completeLap(elapsed: number): void {
    this.currentLap++
    this.lastLapTime = elapsed - this.lapStartTime

    if (this.lastLapTime < this.bestLapTime || this.bestLapTime === 0) {
      this.bestLapTime = this.lastLapTime
    }

    this.justCompletedLap = this.lastLapTime
    this.lapTimes.push({lap: this.currentLap, time: this.lastLapTime})

    this.lapStartTime = elapsed
    // No additional lap-based battery deductions – continuous drain handles depletion.
  }

  private getTrackPosition(): TrackPosition {
    // Interpolate between track profile points
    const profileIndex = Math.floor(this.currentProgress * (this.TRACK_PROFILE.length - 1))
    const nextIndex = Math.min(profileIndex + 1, this.TRACK_PROFILE.length - 1)
    const t = (this.currentProgress * (this.TRACK_PROFILE.length - 1)) % 1

    const current = this.TRACK_PROFILE[profileIndex]
    const next = this.TRACK_PROFILE[nextIndex]

    // Interpolate GPS coordinates along track perimeter
    const angle = this.currentProgress * 2 * Math.PI
    const centerLat = (this.TRACK_BOUNDS.north + this.TRACK_BOUNDS.south) / 2
    const centerLon = (this.TRACK_BOUNDS.east + this.TRACK_BOUNDS.west) / 2
    const radiusLat = ((this.TRACK_BOUNDS.north - this.TRACK_BOUNDS.south) / 2) * 0.8
    const radiusLon = ((this.TRACK_BOUNDS.east - this.TRACK_BOUNDS.west) / 2) * 0.8

    return {
      lat: centerLat + radiusLat * Math.cos(angle + Math.PI / 2),
      lon: centerLon + radiusLon * Math.sin(angle + Math.PI / 2),
      alt: 25.3 + Math.sin(angle * 3) * 2, // Elevation changes
      progress: this.currentProgress,
      sector: current.sector,
      speed: this.currentSpeed,
      banking: current.banking + (next.banking - current.banking) * t
    }
  }

  private getTargetSpeed(trackPos: TrackPosition): number {
    // Find closest track profile point
    const profilePoint = this.TRACK_PROFILE.reduce((closest, point) => {
      const currentDist = Math.abs(point.progress - trackPos.progress)
      const closestDist = Math.abs(closest.progress - trackPos.progress)
      return currentDist < closestDist ? point : closest
    })

    let baseSpeed = profilePoint.targetSpeed

    // Scenario modifications
    switch (this.config.scenario) {
      case "qualifying":
        baseSpeed *= 1.05 // Push harder
        break
      case "race":
        baseSpeed *= 0.98 // Conservative
        break
      case "incident":
        if (Math.random() < 0.02) {
          // 2% chance of incident per frame
          baseSpeed *= 0.3 // Dramatic slowdown
        }
        break
      case "battery_test":
        baseSpeed *= 0.85 + (this.batteryCapacity / 100) * 0.15 // Speed based on battery
        break
    }

    return baseSpeed
  }

  private getMaxAcceleration(): number {
    // Maximum longitudinal acceleration capability in m/s² for a small electric kart
    // Values correspond to roughly 0.3-0.5 g, far below full-size race car levels
    switch (this.config.scenario) {
      case "qualifying":
        return 4.0 // Push harder
      case "practice":
        return 3.0 // Smooth learning laps
      case "race":
        return 3.5 // Balanced
      case "incident":
        return 2.0 // Cautious
      case "battery_test":
        return 2.5 // Efficiency mode
      default:
        return 3.0
    }
  }

  private calculateRPM(trackPos: TrackPosition): number {
    // Wheel circumference based on 58 cm diameter
    const wheelCircumferenceM = 1.823

    // Convert speed (km/h) to wheel RPM
    // wheel_rpm = speed_kmh * 1000 / (circ_m * 60)
    const wheelRpm = (trackPos.speed * 1000) / (wheelCircumferenceM * 60)

    // Add scenario multiplier to mimic motor-side RPM (higher during qualifying)
    const scenarioMultiplier = this.config.scenario === "qualifying" ? 1.05 : 1.0

    const noise = (Math.random() - 0.5) * 10 // small ±10 RPM measurement noise

    return Math.round(wheelRpm * scenarioMultiplier + noise)
  }

  private calculateAcceleration(trackPos: TrackPosition): [number, number, number] {
    // Calculate G-forces based on speed, banking, and cornering
    const corneringRadius = this.getCorneringRadius(trackPos)
    const lateralG = trackPos.speed ** 2 / (corneringRadius * 9.81) / 1000 // Lateral G-force
    const longitudinalG = this.getLongitudinalG(trackPos) // Acceleration/braking
    const verticalG = 1.0 + trackPos.banking * 0.1 // Banking effect

    // Convert to mg (milligravity) as expected by the system
    return [
      Math.round(lateralG * 1000 + (Math.random() - 0.5) * 50),
      Math.round(longitudinalG * 1000 + (Math.random() - 0.5) * 30),
      Math.round(verticalG * 1000 + (Math.random() - 0.5) * 20)
    ]
  }

  private getCorneringRadius(trackPos: TrackPosition): number {
    // Estimate cornering radius based on track position
    const speedFactor = trackPos.speed / 100
    return 50 + speedFactor * 150 // 50-200m radius
  }

  private getLongitudinalG(trackPos: TrackPosition): number {
    // Calculate acceleration/braking G-force
    const targetSpeed = this.getTargetSpeed(trackPos)
    const speedDiff = targetSpeed - trackPos.speed
    const maxG = this.config.scenario === "qualifying" ? 0.8 : 0.6

    return Math.max(-maxG, Math.min(maxG, speedDiff / 50))
  }

  private calculatePower(trackPos: TrackPosition): {voltage: number; current: number} {
    // Power consumption based on speed, acceleration, and scenario
    const baseVoltage = 40000 + (this.batteryCapacity / 100) * 8000 // 40V-48V linear model

    // Ensure voltage never rises: add only downward or zero noise
    const negativeNoise = -Math.random() * 100 // 0 to -100 mV measurement noise
    let voltageMv = Math.round(baseVoltage + negativeNoise)

    // Clamp to non-increasing trend
    if (voltageMv > this.lastVoltageMv) {
      voltageMv = this.lastVoltageMv - Math.floor(Math.random() * 3) // small step down
    }

    // Update last voltage for next frame
    this.lastVoltageMv = voltageMv

    // Estimate current draw – proportional to speed & acceleration
    const speedPower = trackPos.speed * 10 // W per km/h
    const accelerationPower = Math.abs(this.getLongitudinalG(trackPos)) * 100 // W per g
    const baseLoad = 200 // W idle systems load

    const totalPower = speedPower + accelerationPower + baseLoad

    // Electrical current in amperes
    let currentA = totalPower / (voltageMv / 1000)

    // Scenario multiplier (affects power draw)
    let scenarioMultiplier = 1.0
    switch (this.config.scenario) {
      case "qualifying":
        scenarioMultiplier = 1.15 // push harder
        break
      case "race":
        scenarioMultiplier = 1.0
        break
      case "practice":
        scenarioMultiplier = 0.9
        break
      case "battery_test":
        scenarioMultiplier = 0.75
        break
      case "incident":
        scenarioMultiplier = 0.6
        break
    }

    currentA *= scenarioMultiplier

    // Clamp to 17 A max discharge capability
    currentA = Math.min(currentA, 17)

    // Convert to milliamps for compressed packet
    const noiseMa = (Math.random() - 0.5) * 60 // ±60 mA measurement noise
    const currentMa = Math.round(currentA * 1000 + noiseMa)

    return {
      voltage: voltageMv,
      current: currentMa
    }
  }

  // Public getters for dashboard display
  public getCurrentLap(): number {
    return this.currentLap
  }
  public getLastLapTime(): number {
    return this.lastLapTime
  }
  public getBestLapTime(): number {
    return this.bestLapTime
  }
  public getCurrentSector(): number {
    const trackPos = this.getTrackPosition()
    return trackPos.sector
  }
  public getBatteryLevel(): number {
    return this.batteryCapacity
  }
  public getTotalDistance(): number {
    return this.totalDistance
  }
  public getScenario(): string {
    return this.config.scenario
  }
  public getLapTimes(): {lap: number; time: number}[] {
    return this.lapTimes
  }
}
