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
  build: {
    rollupOptions: {
      output: {
        /**
         * React aparte, y nada más.
         *
         * El objetivo es la caché del navegador: `react`/`react-dom` no cambian entre deploys,
         * así que en su propio chunk el usuario los descarga una vez y no en cada publicación.
         * `lucide-react` NO se separa a mano — se tree-shakea por ícono y se comparte entre
         * vistas; partirlo obligaría a descargar los íconos de todas las vistas para abrir una.
         * El resto del reparto lo decide Rollup con los `React.lazy` de `App.tsx`.
         */
        manualChunks: { react: ["react", "react-dom"] },
      },
    },
  },
  test: {
    // `node` alcanza para la lógica pura de seguimientos (fechas, estados, mapeo a GHL).
    // Cambiar a "jsdom" el día que se testee un componente.
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
  },
});
