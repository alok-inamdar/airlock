import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    reporters: ["default"],
  },
});
