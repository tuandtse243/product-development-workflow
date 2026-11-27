import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Inside the project, not node_modules/.vite: node_modules may be a read-only shared install.
  cacheDir: ".cache/vite",
  server: {
    // The clinic API runs on its own (another repository); in development the app reaches it through this proxy.
    proxy: { "/api": "http://localhost:3000" },
  },
});
