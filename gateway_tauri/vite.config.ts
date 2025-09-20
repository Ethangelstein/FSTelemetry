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
      host: true,
      strictPort: true,
      port: 1420,
      hmr: {overlay: true}
    },
    build: {
      target: ["es2021"],
      outDir: "dist",
      assetsDir: "assets"
    }
  }
})
