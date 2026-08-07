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
 * Archivos que pueden hablar con `closer_*` sin importar el helper, porque **son** el helper.
 */
const EXENTOS = new Set(["_lib/db.ts", "_lib/repo.ts"]);

/**
 * Los usos autorizados de `dbSinScope()`. Cada uno se agrega **a mano y con motivo**, así
 * aparece en el diff y alguien lo mira.
 *
 * Todos los de hoy son de autenticación y comparten la misma razón: **corren antes de que
 * exista una organización que aplicar**. Averiguar de qué empresa es alguien es justamente lo
 * que hacen, así que scoparlos sería circular. Y las tablas que tocan (`closer_usuarios`,
 * `closer_sesiones`, `closer_auditoria_accesos`, `closer_org_config`) son **transversales**:
 * una sesión pertenece a una persona, no a una empresa.
 */
const ESCOTILLA_AUTORIZADA = new Set([
  // Resuelve sesión → usuario → empresa efectiva. Es quien AVERIGUA la organización.
  "_lib/auth.ts",
  // Crea, renueva y cierra sesiones; `closer_sesiones` no tiene org_id y no debe tenerlo.
  "_lib/sesion.ts",
  // Busca al usuario por email: antes del login no hay ni sesión ni empresa.
  "auth/login.ts",
  // Lee el usuario y la empresa efectiva para armar el sidebar; cambia la contraseña.
  "auth/sesion.ts",
  // Crea el super admin cuando todavía no hay ningún usuario en el sistema.
  "admin/bootstrap.ts",
]);

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
      // Los de la escotilla no tienen que importar `db`: su uso ya lo audita el test de
      // abajo, que es el que exige la justificación por escrito.
      if (ESCOTILLA_AUTORIZADA.has(a.rel)) return false;
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
    const usos = ARCHIVOS.filter(
      (a) => a.rel !== DUENO_DEL_CLIENTE && /\bdbSinScope\s*\(/.test(a.texto),
    ).map((a) => a.rel);

    const noAutorizados = usos.filter((u) => !ESCOTILLA_AUTORIZADA.has(u));
    expect(
      noAutorizados,
      `Usan la escotilla sin estar en la lista: ${noAutorizados.join(", ")}. ` +
        `Si el uso es legítimo, agregalo a ESCOTILLA_AUTORIZADA con un comentario que diga por qué.`,
    ).toEqual([]);
  });

  it("la lista de la escotilla no tiene entradas muertas", () => {
    /**
     * Si un archivo deja de usar `dbSinScope()` —o se borra— su permiso tiene que irse con
     * él. Una lista de excepciones que solo crece deja de ser una lista de excepciones.
     */
    const usanDeVerdad = new Set(
      ARCHIVOS.filter((a) => /\bdbSinScope\s*\(/.test(a.texto)).map((a) => a.rel),
    );
    const sobrantes = [...ESCOTILLA_AUTORIZADA].filter((p) => !usanDeVerdad.has(p));
    expect(sobrantes, `Ya no usan la escotilla y siguen autorizados: ${sobrantes.join(", ")}`).toEqual([]);
  });
});
