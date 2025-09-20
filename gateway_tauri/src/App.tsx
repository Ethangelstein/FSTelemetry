import {TauriProvider} from "./core/tauri/TauriProvider"
import Home from "./pages/Home"

export default function App() {
  return (
    <TauriProvider>
      <Home />
    </TauriProvider>
  )
}
