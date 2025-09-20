import {invoke} from "@tauri-apps/api/core"
import {useTauri} from "../core/tauri/TauriProvider"

export default function DemoButtons() {
  const t = useTauri()

  const enableDemo = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === "1"

  const show = t.isTauri && enableDemo && !t.open
  if (!show) return null

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
