/**
 * La capa 2 del aislamiento multi-empresa (ESPEC-MULTIEMPRESA §2.4).
 *
 * La capa 1 —el helper `db(orgId)` que inyecta `org_id` en toda consulta— es una convención,
 * y las convenciones se erosionan. Alcanza con que alguien, apurado, escriba
 * `createClient(...)` en un handler para que ese endpoint quede fuera del aislamiento y nadie
 * se entere hasta que un cliente vea los datos de otro.
 *
 * Este test recorre `api/**` y falla si eso pasa. La especificación lo pide con todas las
 * letras: *"Sin este test, la capa 1 se erosiona en la primera semana."*
 *
 * No mira comportamiento: mira el código fuente. Es un lint con forma de test, y va acá
 * porque `npm test` corre en cada commit y un lint aparte no lo correría nadie.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url)); // …/api/_lib
const API = join(AQUI, "..");

/** El único archivo autorizado a crear un cliente de Supabase. */
const DUENO_DEL_CLIENTE = "_lib/db.ts";

/**
 * Archivos que pueden hablar con `closer_*` sin importar el helper, porque **son** el helper
 * o porque su trabajo es inspeccionar el esquema, no leer datos de negocio.
 */
const EXENTOS = new Set(["_lib/db.ts", "_lib/repo.ts"]);

function archivosTs(raiz: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(raiz)) {
    const ruta = join(raiz, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...archivosTs(ruta));
      continue;
    }
    if (entrada.endsWith(".ts") && !entrada.endsWith(".test.ts")) salida.push(ruta);
  }
  return salida;
}

const ARCHIVOS = archivosTs(API).map((ruta) => ({
  rel: relative(API, ruta).split("\\").join("/"),
  texto: readFileSync(ruta, "utf8"),
}));

describe("capa 2 · nadie se saltea el helper de scoping", () => {
  it("hay archivos que auditar (el propio test no se rompió en silencio)", () => {
    // Sin esto, un cambio en la estructura de carpetas dejaría el test pasando sobre cero
    // archivos y el proyecto sin la capa 2, exactamente igual que si no existiera.
    expect(ARCHIVOS.length).toBeGreaterThan(30);
  });

  it("solo _lib/db.ts crea un cliente de Supabase", () => {
    const culpables = ARCHIVOS.filter(
      (a) => a.rel !== DUENO_DEL_CLIENTE && /createClient\s*\(/.test(a.texto),
    ).map((a) => a.rel);

    expect(
      culpables,
      `Estos archivos crean su propio cliente y quedan FUERA del aislamiento por empresa. ` +
        `Tienen que importar db() de _lib/repo.js: ${culpables.join(", ")}`,
    ).toEqual([]);
  });

  it("nadie importa createClient de supabase-js salvo _lib/db.ts", () => {
    const culpables = ARCHIVOS.filter(
      (a) => a.rel !== DUENO_DEL_CLIENTE && /import\s*\{[^}]*createClient[^}]*\}\s*from\s*["']@supabase\/supabase-js["']/.test(a.texto),
    ).map((a) => a.rel);

    expect(culpables, `Importan createClient sin ser el dueño: ${culpables.join(", ")}`).toEqual([]);
  });

  it("todo archivo que consulta una tabla closer_* obtiene su cliente del helper", () => {
    const culpables = ARCHIVOS.filter((a) => {
      if (EXENTOS.has(a.rel)) return false;
      if (!/\.from\(\s*["']closer_/.test(a.texto)) return false;
      // Tiene que traer `db` de repo.js (el atado a la organización) o de db.js.
      return !/import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*["'][^"']*\/(repo|db)\.js["']/.test(a.texto);
    }).map((a) => a.rel);

    expect(
      culpables,
      `Consultan tablas closer_* con un cliente que no viene del helper: ${culpables.join(", ")}`,
    ).toEqual([]);
  });

  it("la escotilla dbSinScope solo se usa donde está justificada", () => {
    /**
     * `dbSinScope()` existe para lo que de verdad no se puede scopear —resolver la empresa a
     * partir del `locationId` de un webhook ocurre ANTES de saber de qué empresa se trata—.
     * Cada uso nuevo tiene que sumarse acá a mano y con motivo, así aparece en el diff y
     * alguien lo mira. Hoy no la usa nadie en `api/`.
     */
    const PERMITIDOS = new Set<string>([]);

    const usos = ARCHIVOS.filter(
      (a) => a.rel !== DUENO_DEL_CLIENTE && /\bdbSinScope\s*\(/.test(a.texto),
    ).map((a) => a.rel);

    const noPermitidos = usos.filter((u) => !PERMITIDOS.has(u));
    expect(
      noPermitidos,
      `Usan la escotilla sin estar en la lista: ${noPermitidos.join(", ")}. ` +
        `Si el uso es legítimo, agregalo a PERMITIDOS con un comentario que diga por qué.`,
    ).toEqual([]);
  });
});
