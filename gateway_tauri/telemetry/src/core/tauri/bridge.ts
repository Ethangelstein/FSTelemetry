import {invoke} from "@tauri-apps/api/core"
import {listen, UnlistenFn} from "@tauri-apps/api/event"
import type {Telemetry, FrameEv} from "./types"
import {EV, isTauri} from "./types"

export const TauriBridge = {
  async listPorts(): Promise<string[]> {
    if (!isTauri) return []
    return invoke<string[]>("list_ports")
  },
  async open(opts: {
    portName: string
    baud: number
    magic0?: number
    magic1?: number
    frameSize?: number
    useCrc?: boolean
  }) {
    if (!isTauri) return
    const {portName, baud, magic0 = "T".charCodeAt(0), magic1 = "D".charCodeAt(0), frameSize = 60, useCrc = true} = opts
    await invoke("open_port", {portName, baud, magic0, magic1, frameSize, useCrc})
  },
  async writeHex(dataHex: string) {
    if (!isTauri) return
    await invoke("write_bytes", {dataHex})
  },
  async close() {
    if (!isTauri) return
    await invoke("close_port")
  },
  onFrame(handler: (e: FrameEv) => void): Promise<UnlistenFn | undefined> {
    if (!isTauri) return Promise.resolve(undefined)
    return listen<FrameEv>(EV.SerialFrame, ev => handler(ev.payload))
  },
  onTelemetry(handler: (t: Telemetry) => void): Promise<UnlistenFn | undefined> {
    if (!isTauri) return Promise.resolve(undefined)
    return listen<Telemetry>(EV.Telemetry, ev => handler(ev.payload))
  },
  onError(handler: (msg: string) => void): Promise<UnlistenFn | undefined> {
    if (!isTauri) return Promise.resolve(undefined)
    return listen<string>(EV.SerialError, ev => handler(ev.payload))
  }
}
