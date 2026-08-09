/**
 * Corre la prueba de integración contra SOFIA y GHL de verdad.
 *
 *     npm run test:integracion              → solo lectura
 *     npm run test:integracion -- --escribir → también las escrituras
 *
 * ── Por qué un script y no `INTEGRACION=1 vitest ...` en package.json ──
 *
 * Porque el prefijo `VAR=valor comando` es sintaxis de shell POSIX y **en PowerShell es un error
 * de parseo**, no una variable. Este repo se desarrolla en Windows: el script del `package.json`
 * habría fallado en la máquina donde más se usa.
 *
 * La alternativa era sumar `cross-env` — una dependencia entera para exportar una variable. Esto
 * son diez líneas y encima puede documentar el guard de escritura, que es lo que evita que una
 * corrida distraída le mande tres mensajes a una persona real durante siete días.
 */

import { spawnSync } from "node:child_process";

const escribir = process.argv.includes("--escribir");

/**
 * `INTEGRACION_ESCRITURA` es una compuerta aparte a propósito. Los efectos en GHL se ejercitan
 * solo en modo stub, pero las escrituras en Supabase sí son reales — y aplicar
 * `seguimiento_recupero` a un contacto de verdad dispara un workflow que no se deshace quitando
 * el tag.
 */
const env = { ...process.env, INTEGRACION: "1", ...(escribir ? { INTEGRACION_ESCRITURA: "1" } : {}) };

if (!escribir) {
  console.log("· Modo lectura. Para ejercitar también las escrituras: npm run test:integracion -- --escribir\n");
}

const r = spawnSync("npx", ["vitest", "run", "api/_lib/integracion.test.ts"], {
  stdio: "inherit",
  env,
  // Windows resuelve `npx` como `npx.cmd`, que necesita shell.
  shell: true,
});

process.exit(r.status ?? 1);
