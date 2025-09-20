import {defineConfig} from "vite"
import path from "node:path"

export default defineConfig(async ({mode}) => {
  const react = (await import("@vitejs/plugin-react-swc")).default
  const svgr = (await import("vite-plugin-svgr")).default

  return {
    base: "./",
    plugins: [react(), svgr()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src")
      }
    },
    server: {
      strictPort: true,
      port: 1420, // común en Tauri
      hmr: {overlay: true}
    },
    build: {
      target: ["es2021"], // recomendado para Tauri (Chrome 110+)
      outDir: "dist",
      assetsDir: "assets"
    }
  }
})
