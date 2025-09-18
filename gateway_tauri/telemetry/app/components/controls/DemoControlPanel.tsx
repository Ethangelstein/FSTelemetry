"use client"

import {useState, useEffect} from "react"
import {demoBackgroundService} from "../../core/demo/DemoBackgroundService"

export default function DemoControlPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [demoState, setDemoState] = useState<any>(null)
  const [selectedScenario, setSelectedScenario] = useState<string>("practice")
  const [selectedSpeed, setSelectedSpeed] = useState<number>(1)

  // Update demo state periodically
  useEffect(() => {
    const updateState = () => {
      setDemoState(demoBackgroundService.getDemoState())
    }

    updateState() // Initial update
    const interval = setInterval(updateState, 1000) // Update every second

    return () => clearInterval(interval)
  }, [])

  const handleStartDemo = () => {
    demoBackgroundService.startDemo(selectedScenario as any, selectedSpeed)
    setDemoState(demoBackgroundService.getDemoState())
  }

  const handleStopDemo = () => {
    demoBackgroundService.stopDemo()
    setDemoState(null)
  }

  const handleScenarioChange = (scenario: string) => {
    setSelectedScenario(scenario)
    if (demoState?.scenario) {
      demoBackgroundService.changeScenario(scenario as any)
    }
  }

  const handleSpeedChange = (speed: number) => {
    setSelectedSpeed(speed)
    if (demoState?.speedMultiplier) {
      demoBackgroundService.changeSpeedMultiplier(speed)
    }
  }

  const scenarios = demoBackgroundService.getAvailableScenarios()
  const speedOptions = demoBackgroundService.getSpeedMultiplierOptions()
  const isActive = demoBackgroundService.isDemoActive()

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`mb-2 px-4 py-2 border-2 font-mono text-sm font-bold transition-all ${
          isActive
            ? "border-orange-400 text-orange-400 bg-orange-900/20"
            : "border-gray-600 text-gray-400 hover:border-blue-400 hover:text-blue-400"
        }`}
        title={isActive ? "Demo Active - Click to open controls" : "Open Demo Controls"}
      >
        {isActive ? "🎮 DEMO ACTIVE" : "🎮 DEMO"}
      </button>

      {/* Control Panel */}
      {isOpen && (
        <div className="bg-black border-2 border-blue-400 p-4 font-mono w-80 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-blue-400 font-bold text-sm">DEMO CONTROL PANEL</h3>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white text-lg leading-none">
              ×
            </button>
          </div>

          {/* Demo Status */}
          <div className="mb-4 p-2 border border-gray-600 bg-gray-900/50">
            <div className="text-xs text-gray-400 uppercase mb-1">STATUS</div>
            <div className={`text-sm font-bold ${isActive ? "text-orange-400" : "text-gray-400"}`}>
              {isActive ? "DEMO RUNNING" : "DEMO STOPPED"}
            </div>
            {isActive && demoState && (
              <div className="text-xs text-gray-400 mt-1">
                {scenarios.find(s => s.id === demoState.scenario)?.name} @ {demoState.speedMultiplier}x
              </div>
            )}
          </div>

          {/* Scenario Selection */}
          <div className="mb-4">
            <label className="text-xs text-gray-400 uppercase mb-2 block">SCENARIO</label>
            <select
              value={selectedScenario}
              onChange={e => handleScenarioChange(e.target.value)}
              className="w-full bg-black border border-gray-600 text-white p-2 text-sm"
            >
              {scenarios.map(scenario => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </select>
            {scenarios.find(s => s.id === selectedScenario) && (
              <div className="text-xs text-gray-400 mt-1">
                {scenarios.find(s => s.id === selectedScenario)?.description}
              </div>
            )}
          </div>

          {/* Speed Multiplier */}
          <div className="mb-4">
            <label className="text-xs text-gray-400 uppercase mb-2 block">SPEED</label>
            <select
              value={selectedSpeed}
              onChange={e => handleSpeedChange(Number(e.target.value))}
              className="w-full bg-black border border-gray-600 text-white p-2 text-sm"
            >
              {speedOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Control Buttons */}
          <div className="space-y-2 mb-4">
            {!isActive ? (
              <button
                onClick={handleStartDemo}
                className="w-full px-4 py-2 border-2 border-green-400 text-green-400 hover:bg-green-900/20 text-sm font-bold"
              >
                START DEMO
              </button>
            ) : (
              <button
                onClick={handleStopDemo}
                className="w-full px-4 py-2 border-2 border-red-400 text-red-400 hover:bg-red-900/20 text-sm font-bold"
              >
                STOP DEMO
              </button>
            )}
          </div>

          {/* Live Data (when demo is running) */}
          {isActive && demoState && (
            <div className="border-t border-gray-600 pt-4">
              <div className="text-xs text-gray-400 uppercase mb-2">LIVE DATA</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-1">
                  <div>
                    LAP: <span className="text-orange-400">{demoState.lapInfo.currentLap}</span>
                  </div>
                  <div>
                    SECTOR: <span className="text-orange-400">{demoState.lapInfo.currentSector}</span>
                  </div>
                  <div>
                    BATTERY: <span className="text-green-400">{demoState.batteryLevel.toFixed(0)}%</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div>
                    BEST:{" "}
                    <span className="text-orange-400">
                      {demoBackgroundService.formatLapTime(demoState.lapInfo.bestLapTime)}
                    </span>
                  </div>
                  <div>
                    LAST:{" "}
                    <span className="text-orange-400">
                      {demoBackgroundService.formatLapTime(demoState.lapInfo.lastLapTime)}
                    </span>
                  </div>
                  <div>
                    DIST: <span className="text-cyan-400">{(demoState.totalDistance / 1000).toFixed(1)}km</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Instructions */}
          {!isActive && (
            <div className="text-xs text-gray-500 mt-4 p-2 bg-gray-900/30 border border-gray-700">
              <div className="font-bold mb-1">DEMO SYSTEM</div>
              <div>
                • Select scenario and speed
                <br />
                • Click START DEMO to begin
                <br />
                • Demo data feeds through normal API
                <br />
                • Dashboard shows realistic telemetry
                <br />• No data pollution - completely separate
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
