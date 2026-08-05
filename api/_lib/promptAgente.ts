/**
 * El prompt del agente AUDITADO, cargado desde el repo.
 *
 * Pedido de Fabio: que el auditor tenga "dentro suyo" el prompt del agente de texto de GHL,
 * para que su veredicto no diga solo *"prometió un financiamiento que no existe"* sino
 * *"esta línea del prompt lo permite, reemplazala por esta otra"*. Sin el prompt, la
 * corrección es un consejo genérico; con el prompt, es un parche listo para pegar.
 *
 * ## Dónde vive y por qué
 *
 * En `docs/prompts/<agente>.md`, versionado en git (decisión de Fabio, 2026-08-04). La
 * alternativa era una tabla editable desde la app; se descartó para esta pasada.
 *
 * **Hoy esos archivos NO existen** — el prompt vive solo dentro de GHL. Todo este módulo
 * está escrito para que su ausencia sea un estado normal y silencioso, no un error: sin
 * archivo, el auditor sigue funcionando y emite correcciones como instrucciones autónomas
 * en vez de reemplazos citados. Cuando el archivo aparezca **no hay que tocar código**.
 *
 * ## La trampa de Vercel
 *
 * `fs.readFileSync` funciona (el runtime es Node 24, no Edge). Lo que NO funciona es asumir
 * que el archivo va a estar ahí: el builder traza dependencias estáticamente con
 * `@vercel/nft`, y una lectura por path compuesto en runtime no es analizable, así que el
 * `.md` no entra al bundle de la función. Por eso `vercel.json` declara
 * `includeFiles: "docs/prompts/**"` en las entradas que lo usan. (`import "…?raw"` tampoco
 * sirve: es sintaxis de Vite y esbuild no la conoce.)
 *
 * Ese es justamente el modo de fallo peligroso —anda en local, desaparece en producción sin
 * ruido—, y es la razón de que `/api/agentes/auditor-estado` reporte `presente`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgenteTextoId } from "./analizador.js";

export interface PromptAgente {
  /** El texto del prompt. Vacío si el archivo no existe. */
  texto: string;
  /**
   * Identidad de ESTA versión: sha256 del contenido, 12 caracteres.
   *
   * Del contenido y no del commit, porque el archivo puede no cambiar entre commits y dos
   * ramas pueden compartir un commit corto. Cada análisis guarda este hash, y con eso la
   * pestaña puede avisar "el prompt cambió desde que se detectó esto" — sin él, el técnico
   * pega un reemplazo de un fragmento que ya no existe.
   */
  hash: string;
  ruta: string;
  presente: boolean;
  lineas: number;
}

const RUTAS: Record<AgenteTextoId, string> = {
  "appointment-flow-ai": "docs/prompts/appointment-flow-ai.md",
  "lead-flow-ai": "docs/prompts/lead-flow-ai.md",
};

const AUSENTE = (ruta: string): PromptAgente => ({
  texto: "",
  hash: "ausente",
  ruta,
  presente: false,
  lineas: 0,
});

/**
 * Memoizado a nivel de módulo, **incluida la ausencia**.
 *
 * Las funciones de Vercel quedan calientes entre invocaciones y un redeploy crea instancias
 * nuevas, así que el ciclo de vida del proceso ES el TTL correcto: no hace falta invalidar
 * nada, y cachear el "no está" evita repetir dos `statSync` fallidos en cada mensaje.
 */
const cache = new Map<AgenteTextoId, PromptAgente>();

/**
 * Dónde buscar el archivo.
 *
 * Dos candidatos porque el cwd de una función serverless no es el mismo que en local ni que
 * en los tests. Es tolerancia barata que evita el modo de fallo caro: "funciona en mi
 * máquina, silencio en producción".
 */
function candidatos(relativa: string): string[] {
  const aquí = dirname(fileURLToPath(import.meta.url)); // …/api/_lib
  return [
    resolve(process.cwd(), relativa),
    resolve(aquí, "..", "..", relativa), // api/_lib → raíz del repo
  ];
}

export function cargarPromptAgente(agenteId: AgenteTextoId): PromptAgente {
  const cacheado = cache.get(agenteId);
  if (cacheado) return cacheado;

  const relativa = RUTAS[agenteId];
  let resultado = AUSENTE(relativa);

  for (const ruta of candidatos(relativa)) {
    try {
      const texto = readFileSync(ruta, "utf8").trim();
      if (!texto) continue; // un archivo vacío es lo mismo que no tenerlo
      resultado = {
        texto,
        hash: createHash("sha256").update(texto).digest("hex").slice(0, 12),
        ruta: relativa,
        presente: true,
        lineas: texto.split("\n").length,
      };
      break;
    } catch {
      // No está en este candidato. Probar el siguiente; si ninguno da, queda AUSENTE.
    }
  }

  cache.set(agenteId, resultado);
  return resultado;
}

/** Solo para los tests: el memo a nivel de módulo sobreviviría entre casos. */
export function _limpiarCachePrompt(): void {
  cache.clear();
}

/** Estado de los dos prompts, para el endpoint de diagnóstico. Sin exponer el contenido. */
export function estadoDeLosPrompts(): Record<string, { presente: boolean; ruta: string; hash: string; lineas: number }> {
  const salida: Record<string, { presente: boolean; ruta: string; hash: string; lineas: number }> = {};
  for (const id of Object.keys(RUTAS) as AgenteTextoId[]) {
    const p = cargarPromptAgente(id);
    salida[id] = { presente: p.presente, ruta: p.ruta, hash: p.hash, lineas: p.lineas };
  }
  return salida;
}

export { RUTAS as RUTAS_PROMPT };
