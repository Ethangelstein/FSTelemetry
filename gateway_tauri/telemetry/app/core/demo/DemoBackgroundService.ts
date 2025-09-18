import {DemoDataGenerator, DemoConfig, CompressedTelemetryData} from "./DemoDataGenerator"

export class DemoBackgroundService {
  private generator: DemoDataGenerator | null = null
  private interval: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private currentConfig: DemoConfig | null = null
  private telemetryHistory: CompressedTelemetryData[] = []
  private readonly MAX_HISTORY_SIZE = 300 // Store last 5 minutes of data (300 points at 1Hz)

  constructor() {
    // Auto-restore demo state on page load if it was running
    this.restoreState()
  }

  /**
   * Start demo mode with specified scenario
   */
  public startDemo(scenario: DemoConfig["scenario"], speedMultiplier: number = 1): void {
    // Stop any existing demo
    this.stopDemo()

    const config: DemoConfig = {
      scenario,
      speedMultiplier,
      trackId: "buenos_aires",
      startPosition: 0
    }

    this.currentConfig = config
    this.generator = new DemoDataGenerator(config)
    this.isRunning = true

    // Start data generation loop
    this.startDataLoop()

    // Save state
    this.saveState()

    console.log(`🎮 Demo started: ${scenario} at ${speedMultiplier}x speed`)
  }

  /**
   * Stop demo mode
   */
  public stopDemo(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }

    this.generator = null
    this.isRunning = false
    this.currentConfig = null

    // Clear demo state
    this.clearState()

    // Clear demo data from API
    this.clearDemoDataFromAPI()

    console.log("🛑 Demo stopped")
  }

  /**
   * Check if demo is currently running
   */
  public isDemoActive(): boolean {
    return this.isRunning && this.generator !== null
  }

  /**
   * Get current demo state
   */
  public getDemoState() {
    if (!this.isRunning || !this.generator || !this.currentConfig) {
      return null
    }

    return {
      scenario: this.currentConfig.scenario,
      speedMultiplier: this.currentConfig.speedMultiplier,
      lapInfo: {
        currentLap: this.generator.getCurrentLap(),
        lastLapTime: this.generator.getLastLapTime(),
        bestLapTime: this.generator.getBestLapTime(),
        currentSector: this.generator.getCurrentSector()
      },
      batteryLevel: this.generator.getBatteryLevel(),
      totalDistance: this.generator.getTotalDistance()
    }
  }

  /**
   * Change demo scenario (restarts demo)
   */
  public changeScenario(scenario: DemoConfig["scenario"]): void {
    if (this.isRunning && this.currentConfig) {
      this.startDemo(scenario, this.currentConfig.speedMultiplier)
    }
  }

  /**
   * Change speed multiplier (restarts demo)
   */
  public changeSpeedMultiplier(multiplier: number): void {
    if (this.isRunning && this.currentConfig) {
      this.startDemo(this.currentConfig.scenario, multiplier)
    }
  }

  /**
   * Start the data generation and injection loop
   */
  private startDataLoop(): void {
    if (!this.generator || !this.currentConfig) return

    // Fixed RX rate: 1 packet per second (1000 ms)
    const actualInterval = 1000

    this.interval = setInterval(() => {
      this.generateAndInjectData()
    }, actualInterval)
  }

  /**
   * Generate data and inject it into the API
   */
  private generateAndInjectData(): void {
    if (!this.generator) return

    try {
      const demoData = this.generator.generateTelemetryData()
      this.injectDataToAPI(demoData)

      // Store in history
      this.telemetryHistory.push(demoData)
      if (this.telemetryHistory.length > this.MAX_HISTORY_SIZE) {
        this.telemetryHistory.shift()
      }
    } catch (error) {
      console.error("Error generating demo data:", error)
    }
  }

  /**
   * Inject demo data into the API endpoint
   * This makes the data appear as if it came from a real LoRa device
   */
  private async injectDataToAPI(data: CompressedTelemetryData): Promise<void> {
    try {
      // Directly update the API's internal state
      // This is a cleaner approach than making HTTP calls to ourselves
      const response = await fetch("/api/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      })

      if (!response.ok) {
        console.warn("Failed to inject demo data to API")
      }
    } catch (error) {
      console.error("Error injecting demo data:", error)
    }
  }

  /**
   * Clear demo data from API
   */
  private async clearDemoDataFromAPI(): Promise<void> {
    try {
      await fetch("/api/telemetry?mode=demo", {
        method: "DELETE"
      })
      this.telemetryHistory = [] // Clear history as well
    } catch (error) {
      console.warn("Error clearing demo data from API:", error)
    }
  }

  /**
   * Save demo state to localStorage
   */
  private saveState(): void {
    if (!this.currentConfig) return

    try {
      const state = {
        isRunning: this.isRunning,
        config: this.currentConfig,
        startTime: Date.now()
      }
      localStorage.setItem("telemetry_demo_background_state", JSON.stringify(state))
    } catch (error) {
      console.warn("Failed to save demo state:", error)
    }
  }

  /**
   * Restore demo state from localStorage
   */
  private restoreState(): void {
    try {
      const saved = localStorage.getItem("telemetry_demo_background_state")
      if (!saved) return

      const state = JSON.parse(saved)

      // Only restore if demo was active recently (within 1 hour)
      const timeSinceStart = Date.now() - state.startTime
      if (state.isRunning && timeSinceStart < 3600000) {
        this.startDemo(state.config.scenario, state.config.speedMultiplier)
      } else {
        // Clear old state
        this.clearState()
      }
    } catch (error) {
      console.warn("Failed to restore demo state:", error)
      this.clearState()
    }
  }

  /**
   * Clear saved state
   */
  private clearState(): void {
    try {
      localStorage.removeItem("telemetry_demo_background_state")
    } catch (error) {
      console.warn("Failed to clear demo state:", error)
    }
  }

  /**
   * Format lap time for display
   */
  public formatLapTime(milliseconds: number): string {
    if (milliseconds === 0) return "--:--.-"

    const minutes = Math.floor(milliseconds / 60000)
    const seconds = Math.floor((milliseconds % 60000) / 1000)
    const ms = Math.floor((milliseconds % 1000) / 10)

    return `${minutes}:${seconds.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`
  }

  /**
   * Get available scenarios
   */
  public getAvailableScenarios() {
    return [
      {
        id: "practice" as const,
        name: "Practice Session",
        description: "Consistent lap times, learning track layout",
        duration: "15-20 minutes"
      },
      {
        id: "qualifying" as const,
        name: "Qualifying Run",
        description: "Push laps with maximum performance",
        duration: "10-15 minutes"
      },
      {
        id: "race" as const,
        name: "Race Simulation",
        description: "Consistent pace with battery management",
        duration: "20-30 minutes"
      },
      {
        id: "incident" as const,
        name: "Incident Response",
        description: "Recovery from incidents and cautious driving",
        duration: "5-10 minutes"
      },
      {
        id: "battery_test" as const,
        name: "Battery Management",
        description: "Efficiency focus and range optimization",
        duration: "25-35 minutes"
      }
    ]
  }

  /**
   * Get speed multiplier options
   */
  public getSpeedMultiplierOptions() {
    return [
      {value: 0.5, label: "0.5x (Slow)"},
      {value: 1, label: "1x (Real-time)"},
      {value: 2, label: "2x (Fast)"},
      {value: 5, label: "5x (Very Fast)"},
      {value: 10, label: "10x (Testing)"}
    ]
  }
}

// Create singleton instance
export const demoBackgroundService = new DemoBackgroundService()
