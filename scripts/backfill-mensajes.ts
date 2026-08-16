/**
 * Corre el backfill de mensajes desde la línea de comandos.
 *
 * ── Por qué existe, si ya hay un endpoint ─────────────────────────────
 *
 * `api/mensajes-respaldo.ts` exige `CRON_SECRET`, que vive **solo en Vercel**. Esta reparación es
 * de una sola vez y hay que poder dispararla desde acá sin ese secreto.
 *
 * Lo importante: **importa el mismo código que el endpoint**, no una copia. Un script que
 * reimplementara el relleno podría normalizar distinto y dejar filas que no se parecen a las que
 * escribe la vía normal — y el `autor` de un mensaje es justo lo que el auditor usa para saber
 * quién habló.
 *
 * ── Uso ───────────────────────────────────────────────────────────────
 *
 *     npx tsx scripts/backfill-mensajes.ts --dry            (no escribe: solo cuenta)
 *     npx tsx scripts/backfill-mensajes.ts --tope 20        (rellena 20 contactos)
 *     npx tsx scripts/backfill-mensajes.ts                  (rellena todos)
 *
 * Lee las credenciales de `.env.local`, igual que la suite de integración.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// El env se carga ANTES de importar nada que lo lea al evaluarse.
for (const linea of readFileSync(
  resolve(process.cwd(), ".env.local"),
  "utf8",
).split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { backfillMensajes, contactosParaBackfill } =
  await import("../api/_lib/backfillMensajes.js");
const { conCredenciales, organizacionesActivas, resolverCredenciales } =
  await import("../api/_lib/credenciales.js");

const args = process.argv.slice(2);
const seco = args.includes("--dry");
const iTope = args.indexOf("--tope");
const tope = iTope >= 0 ? Number(args[iTope + 1]) : 1000;

if (!Number.isFinite(tope) || tope <= 0) {
  console.error("--tope tiene que ser un número mayor a cero.");
  process.exit(1);
}

const organizaciones = await organizacionesActivas();
console.log(
  `empresas activas: ${organizaciones.length}${seco ? "   [DRY RUN: no escribe nada]" : ""}\n`,
);

for (const orgId of organizaciones) {
  /**
   * Un `try` por empresa, igual que los crons: una empresa cuya credencial no se puede
   * descifrar —clave maestra distinta en esta máquina— no puede llevarse puestas a las demás.
   * Antes el script moría en la primera y no rellenaba ninguna.
   */
  let cred;
  try {
    cred = await resolverCredenciales(orgId);
  } catch (e) {
    console.log(
      `· ${orgId}: no se pudo resolver la credencial (${(e as Error).message.slice(0, 60)}…)`,
    );
    continue;
  }
  if (!cred.ghlPit || !cred.ghlLocationId) {
    console.log(`· ${cred.nombre}: sin credenciales de GHL, se saltea`);
    continue;
  }

  await conCredenciales(cred, async () => {
    const ids = await contactosParaBackfill(tope);
    console.log(`· ${cred.nombre}: ${ids.length} contactos a revisar`);

    if (seco) {
      console.log("  (dry run: no se llamó a GHL ni se escribió nada)\n");
      return;
    }

    const inicio = Date.now();
    const r = await backfillMensajes(ids);
    const seg = Math.round((Date.now() - inicio) / 1000);

    console.log(`  revisados ....... ${r.revisados}`);
    console.log(`  INSERTADOS ...... ${r.insertados}`);
    console.log(`  llamadas a GHL .. ${r.llamadasGhl}`);
    console.log(
      `  sin fecha ....... ${r.sinFecha} (descartados: no se les inventa la hora)`,
    );
    console.log(
      `  truncados ....... ${r.truncados.length}${r.truncados.length ? ` → ${r.truncados.join(", ")}` : ""}`,
    );
    if (r.cortadoPorTiempo)
      console.log(`  CORTADO por tiempo: quedaron ${r.pendientes} sin mirar`);
    console.log(`  errores ......... ${r.errores.length}`);
    for (const e of r.errores.slice(0, 10)) console.log(`      ${e}`);
    console.log(`  tardó ........... ${seg}s\n`);
  });
}

console.log("listo.");
