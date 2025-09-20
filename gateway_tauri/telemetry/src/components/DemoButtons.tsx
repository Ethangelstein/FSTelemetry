import {invoke} from "@tauri-apps/api/core"
import {useTauri} from "../core/tauri/TauriProvider"

export default function DemoButtons() {
  const t = useTauri()
  if (!t.isTauri) return null

  const start = () => invoke("start_demo", {magic0: 84, magic1: 68, frameSize: 64, useCrc: true, periodMs: 100})
  const stop = () => invoke("stop_demo")

  return (
    <div className="fixed bottom-4 left-4 space-x-2">
      <button onClick={start} className="px-3 py-1 border">
        Start demo
      </button>
      <button onClick={stop} className="px-3 py-1 border">
        Stop demo
      </button>
    </div>
  )
}
