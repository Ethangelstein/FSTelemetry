import {createContext, useContext} from "react"
import {useTauriSerial} from "./useTauriSerial"

const Ctx = createContext<ReturnType<typeof useTauriSerial> | null>(null)

export function TauriProvider({children}: {children: React.ReactNode}) {
  const value = useTauriSerial()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTauri() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useTauri must be used within TauriProvider")
  return ctx
}
