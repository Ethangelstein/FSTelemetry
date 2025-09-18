"use client"

import {useState, useEffect} from "react"
import {DemoService, DemoState, DemoScenarioInfo} from "../../core/demo/DemoService"

interface DemoControlsProps {
  demoService: DemoService
  className?: string
}

export default function DemoControls({demoService, className = ""}: DemoControlsProps) {
  const [demoState, setDemoState] = useState<DemoState>(demoService.getState())
  const [showScenarios, setShowScenarios] = useState(false)
  const [showSpeedOptions, setShowSpeedOptions] = useState(false)

  useEffect(() => {
    const unsubscribe = demoService.subscribe(setDemoState)
    return unsubscribe
  }, [demoService])

  const handleToggleDemo = () => {
    if (demoState.isActive) {
      demoService.stopDemo()
    } else {
      demoService.startDemo("practice", 1)
    }
  }

  const handleScenarioChange = (scenario: DemoScenarioInfo["id"]) => {
    demoService.changeScenario(scenario)
    setShowScenarios(false)
  }

  const handleSpeedChange = (multiplier: number) => {
    demoService.changeSpeedMultiplier(multiplier)
    setShowSpeedOptions(false)
  }

  const handleResetDemo = () => {
    demoService.resetDemo()
  }

  const scenarios = demoService.getAvailableScenarios()
  const speedOptions = demoService.getSpeedMultiplierOptions()
  const currentScenario = demoService.getCurrentScenario()
  const sessionInfo = demoService.getSessionInfo()

  return (
    <div className={`bg-black border-2 border-orange-400 p-4 font-mono ${className}`}>
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-4">🎮 DEMO CONTROL SYSTEM</div>

      {/* Main Demo Toggle */}
      <div className="mb-4">
        <button
          onClick={handleToggleDemo}
          className={`w-full py-3 px-4 border-2 font-bold text-sm transition-all ${
            demoState.isActive
              ? "border-orange-400 bg-orange-400/20 text-orange-400 hover:bg-orange-400/30"
              : "border-gray-400 text-gray-400 hover:border-orange-400 hover:text-orange-400"
          }`}
        >
          {demoState.isActive ? "🟢 DEMO ACTIVE" : "⚪ START DEMO"}
        </button>
      </div>

      {/* Demo Active Controls */}
      {demoState.isActive && (
        <>
          {/* Scenario Selection */}
          <div className="mb-4">
            <div className="text-xs text-gray-400 mb-2">SCENARIO</div>
            <div className="relative">
              <button
                onClick={() => setShowScenarios(!showScenarios)}
                className="w-full p-2 border border-orange-400 text-orange-400 text-left text-xs bg-black hover:bg-orange-400/10 flex justify-between items-center"
              >
                <span>{currentScenario?.name || "Select Scenario"}</span>
                <span className="text-xs">{showScenarios ? "▲" : "▼"}</span>
              </button>

              {showScenarios && (
                <div className="absolute top-full left-0 right-0 z-50 bg-black border border-orange-400 mt-1 max-h-64 overflow-y-auto">
                  {scenarios.map(scenario => (
                    <button
                      key={scenario.id}
                      onClick={() => handleScenarioChange(scenario.id)}
                      className={`w-full p-2 text-left text-xs hover:bg-orange-400/20 border-b border-gray-600 last:border-b-0 ${
                        scenario.id === demoState.scenario ? "bg-orange-400/10 text-orange-400" : "text-gray-300"
                      }`}
                    >
                      <div className="font-bold">{scenario.name}</div>
                      <div className="text-gray-400 text-xs mt-1">{scenario.description}</div>
                      <div className="flex gap-1 mt-1">
                        {scenario.characteristics.map((char, idx) => (
                          <span key={idx} className="text-xs bg-gray-800 px-1 rounded">
                            {char}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Speed Multiplier */}
          <div className="mb-4">
            <div className="text-xs text-gray-400 mb-2">SIMULATION SPEED</div>
            <div className="relative">
              <button
                onClick={() => setShowSpeedOptions(!showSpeedOptions)}
                className="w-full p-2 border border-orange-400 text-orange-400 text-left text-xs bg-black hover:bg-orange-400/10 flex justify-between items-center"
              >
                <span>{speedOptions.find(opt => opt.value === demoState.speedMultiplier)?.label || "1x"}</span>
                <span className="text-xs">{showSpeedOptions ? "▲" : "▼"}</span>
              </button>

              {showSpeedOptions && (
                <div className="absolute top-full left-0 right-0 z-50 bg-black border border-orange-400 mt-1">
                  {speedOptions.map(option => (
                    <button
                      key={option.value}
                      onClick={() => handleSpeedChange(option.value)}
                      className={`w-full p-2 text-left text-xs hover:bg-orange-400/20 border-b border-gray-600 last:border-b-0 ${
                        option.value === demoState.speedMultiplier
                          ? "bg-orange-400/10 text-orange-400"
                          : "text-gray-300"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Session Info */}
          <div className="mb-4 p-2 border border-gray-600 bg-gray-900/50">
            <div className="text-xs text-gray-400 mb-2">SESSION INFO</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-400">TIME:</span>
                <span className="text-orange-400 ml-1">{demoService.formatSessionTime(sessionInfo.elapsedTime)}</span>
              </div>
              <div>
                <span className="text-gray-400">LAP:</span>
                <span className="text-orange-400 ml-1">{demoState.lapInfo.currentLap}</span>
              </div>
              <div>
                <span className="text-gray-400">SECTOR:</span>
                <span className="text-orange-400 ml-1">{demoState.lapInfo.currentSector}</span>
              </div>
              <div>
                <span className="text-gray-400">BATTERY:</span>
                <span className="text-orange-400 ml-1">{sessionInfo.batteryLevel.toFixed(0)}%</span>
              </div>
            </div>
          </div>

          {/* Lap Times */}
          {(demoState.lapInfo.bestLapTime > 0 || demoState.lapInfo.lastLapTime > 0) && (
            <div className="mb-4 p-2 border border-gray-600 bg-gray-900/50">
              <div className="text-xs text-gray-400 mb-2">LAP TIMES</div>
              <div className="space-y-1 text-xs">
                {demoState.lapInfo.bestLapTime > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">BEST:</span>
                    <span className="text-green-400">{demoService.formatLapTime(demoState.lapInfo.bestLapTime)}</span>
                  </div>
                )}
                {demoState.lapInfo.lastLapTime > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">LAST:</span>
                    <span className="text-cyan-400">{demoService.formatLapTime(demoState.lapInfo.lastLapTime)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Demo Controls */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleResetDemo}
              className="py-2 px-3 border border-yellow-400 text-yellow-400 text-xs font-bold hover:bg-yellow-400/20 transition-all"
            >
              🔄 RESET
            </button>
            <button
              onClick={handleToggleDemo}
              className="py-2 px-3 border border-red-400 text-red-400 text-xs font-bold hover:bg-red-400/20 transition-all"
            >
              🛑 STOP
            </button>
          </div>
        </>
      )}

      {/* Demo Inactive State */}
      {!demoState.isActive && (
        <div className="text-center py-4">
          <div className="text-gray-400 text-xs mb-2">Start demo to test telemetry features without real data</div>
          <div className="text-xs text-gray-500">Demo data will not interfere with live telemetry</div>
        </div>
      )}

      {/* Demo Status Indicator */}
      <div className="mt-4 pt-2 border-t border-gray-600">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">STATUS:</span>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 ${demoState.isActive ? "bg-orange-400 animate-pulse" : "bg-gray-600"}`}></div>
            <span className={demoState.isActive ? "text-orange-400" : "text-gray-400"}>
              {demoState.isActive ? "DEMO MODE" : "LIVE MODE"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
