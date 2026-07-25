/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // `node` alcanza para la lógica pura de seguimientos (fechas, estados, mapeo a GHL).
    // Cambiar a "jsdom" el día que se testee un componente.
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
  },
});
