/**
 * El prompt del agente AUDITADO, cargado de la configuración de su empresa.
 *
 * Pedido de Fabio: que el auditor tenga "dentro suyo" el prompt del agente de texto de GHL,
 * para que su veredicto no diga solo *"prometió un financiamiento que no existe"* sino
 * *"esta línea del prompt lo permite, reemplazala por esta otra"*. Sin el prompt, la
 * corrección es un consejo genérico; con el prompt, es un parche listo para pegar.
 *
 * ## De archivo del repo a columna de la empresa (2026-08-07)
 *
 * Hasta hoy esto leía `docs/prompts/<agente>.md` con `readFileSync`, y era la decisión correcta
 * cuando había un solo cliente. Con cinco deja de serlo por dos motivos distintos:
 *
 *   1. **El prompt es de cada subcuenta de GHL.** Un archivo en el repo solo puede tener uno, y
 *      auditar al agente de la empresa B contra el prompt de ARIA no da un resultado peor: da
 *      un resultado convincente y falso.
 *   2. **Cambiarlo exigía un deploy.** El cliente no puede pedirle un commit a nadie cada vez
 *      que ajusta su propio agente.
 *
 * Ahora sale de `closer_org_config` (§7.3, columnas de la migración `018`), que es donde el
 * panel de Ajustes › Credenciales ya lo escribía desde la fase 4. **Ese era el problema real:**
 * el camino de escritura estaba terminado —el cliente pegaba el prompt, veía su hash y sus
 * líneas confirmados en pantalla— y el de lectura seguía mirando dos archivos que nunca
 * existieron. La UI reportaba un éxito sin efecto, que es lo que §4.2 prohíbe.
 *
 * ## Por qué sigue siendo SÍNCRONA
 *
 * Podría leer de la base acá y sería lo obvio. No lo hace: el prompt viene resuelto dentro de
 * `Credenciales`, junto con el resto de la configuración de la empresa, y esta función solo lo
 * saca del contexto activo. El motivo es concreto — `api/agentes/alertas.ts` la llama dentro de
 * un `map` síncrono, así que volverla `async` propagaba `await` por toda la capa de alertas
 * para no ganar nada: la consulta ya se hizo, una vez por request, con la caché de 60 s de
 * `resolverCredenciales`.
 *
 * ## La ausencia sigue siendo un estado normal
 *
 * Una empresa que no cargó su prompt no es un error. El auditor degrada limpio: emite la
 * corrección como instrucción autónoma en vez de citar un fragmento (§7.3), y
 * `/api/agentes/auditor-estado` lo reporta en `presente`.
 *
 * Con esto se cae la dependencia de `includeFiles: "docs/prompts/**"` en `vercel.json`, y con
 * ella la trampa que la justificaba: `@vercel/nft` no puede trazar una lectura por path
 * compuesto, así que el `.md` no entraba al bundle y el modo de fallo era el peor —andaba en
 * local y desaparecía en producción sin ruido—.
 */

import { createHash } from "node:crypto";
import { credencialesActivas } from "./credenciales.js";
import type { AgenteTextoId } from "./analizador.js";

export interface PromptAgente {
  /** El texto del prompt. Vacío si la empresa no cargó ninguno. */
  texto: string;
  /**
   * Identidad de ESTA versión: sha256 del contenido, 12 caracteres.
   *
   * Se calcula del TEXTO en cada lectura, y no se lee de la columna `*_hash` que el panel de
   * administración guarda al lado. Son dos hechos distintos: la columna dice qué hash tenía el
   * texto cuando se guardó, y esto dice qué hash tiene el texto que el auditor está usando
   * ahora. Si alguien editara la fila por SQL los dos dejarían de coincidir, y el que importa
   * para comparar contra `closer_hallazgo_agente.prompt_hash` es este.
   *
   * Cada análisis guarda este hash, y con eso la pestaña puede avisar "el prompt cambió desde
   * que se detectó esto" — sin él, el técnico pega un reemplazo de un fragmento que ya no
   * existe.
   */
  hash: string;
  /**
   * De dónde salió, para mostrárselo a un humano. Ya NO es una ruta de archivo: dice la columna
   * y la empresa (`closer_org_config.prompt_lead_texto · ARIA IA`).
   *
   * Se mantiene el nombre del campo a propósito. Viaja hasta el browser —`promptRef.archivo` en
   * la respuesta de `api/agentes/alertas.ts`— y renombrarlo obligaba a tocar el contrato del
   * frontend para cambiar una etiqueta. Lo que cambió es el valor, no el sentido: sigue siendo
   * "dónde está el prompt que usé".
   */
  ruta: string;
  presente: boolean;
  lineas: number;
}

/**
 * Qué campo de la configuración le corresponde a cada agente.
 *
 * Ojo con el cruce de nombres, que es una trampa para quien lea rápido: el id del agente dice
 * `appointment-flow-ai` y su columna dice `prompt_appointment_texto`. El `-ai` del id significa
 * "el agente de IA" y el `_texto` de la columna significa "chat, no voz" — no son lo mismo.
 */
const CAMPOS: Record<AgenteTextoId, "promptAppointmentTexto" | "promptLeadTexto"> = {
  "appointment-flow-ai": "promptAppointmentTexto",
  "lead-flow-ai": "promptLeadTexto",
};

/** El nombre de la columna, solo para decírselo a un humano. */
const COLUMNAS: Record<AgenteTextoId, string> = {
  "appointment-flow-ai": "prompt_appointment_texto",
  "lead-flow-ai": "prompt_lead_texto",
};

const AUSENTE = (ruta: string): PromptAgente => ({
  texto: "",
  hash: "ausente",
  ruta,
  presente: false,
  lineas: 0,
});

/** Cómo se le nombra la fuente a un humano. Sin empresa activa lo dice, en vez de mentir. */
function referencia(agenteId: AgenteTextoId, nombreEmpresa: string | null): string {
  const col = `closer_org_config.${COLUMNAS[agenteId]}`;
  return nombreEmpresa ? `${col} · ${nombreEmpresa}` : `${col} (sin empresa activa)`;
}

/**
 * Memoizado a nivel de módulo, **incluida la ausencia**.
 *
 * Las funciones de Vercel quedan calientes entre invocaciones y un redeploy crea instancias
 * nuevas, así que el ciclo de vida del proceso ES el TTL correcto: no hace falta invalidar
 * nada, y cachear el "no está" evita rearmar el objeto en cada mensaje.
 *
 * ── La clave lleva la empresa (2026-08-07) ────────────────────────────
 *
 * Estaba indexado **solo por agente**, y el razonamiento del párrafo de arriba era correcto con
 * una sola empresa. Con dos deja de serlo: el prompt del chatbot es propio de cada subcuenta de
 * GHL, así que una instancia caliente que ya cacheó el de ARIA le serviría ese mismo texto al
 * auditor de la empresa B — que entonces mide al agente de B contra las instrucciones de ARIA y
 * reporta como incumplimiento todo lo que difiera.
 *
 * Ese es el peor tipo de bug de los que aparecen acá: no falla, produce hallazgos convincentes
 * y falsos.
 */
const cache = new Map<string, PromptAgente>();

/** La clave del caché: empresa + agente. Fuera de contexto, `sin-empresa`. */
function clave(agenteId: AgenteTextoId): string {
  return `${credencialesActivas()?.orgId ?? "sin-empresa"}:${agenteId}`;
}

export function cargarPromptAgente(agenteId: AgenteTextoId): PromptAgente {
  const cacheado = cache.get(clave(agenteId));
  if (cacheado) return cacheado;

  const cred = credencialesActivas();
  const ref = referencia(agenteId, cred?.nombre ?? null);

  /**
   * Sin empresa activa devuelve AUSENTE y **no lanza**, a diferencia de `db()`. La asimetría es
   * deliberada: una consulta sin organización puede devolver los datos de otra empresa, mientras
   * que un prompt sin organización solo hace que el auditor pierda una referencia y degrade a
   * instrucción autónoma. Lo segundo no justifica tirar un análisis.
   *
   * Tampoco se cachea: la clave sería `sin-empresa:<agente>` y quedaría envenenando la instancia
   * caliente para el primer request que sí traiga contexto.
   */
  if (!cred) return AUSENTE(ref);

  /**
   * `resolverCredenciales` ya normaliza el vacío a `null`; este `trim` cubre el caso de que
   * algún día deje de hacerlo. Un prompt de cadena vacía y uno sin cargar son el mismo hecho.
   */
  const texto = (cred[CAMPOS[agenteId]] ?? "").trim();

  const resultado: PromptAgente = texto
    ? {
        texto,
        hash: createHash("sha256").update(texto).digest("hex").slice(0, 12),
        ruta: ref,
        presente: true,
        lineas: texto.split("\n").length,
      }
    : AUSENTE(ref);

  cache.set(clave(agenteId), resultado);
  return resultado;
}

/** Solo para los tests: el memo a nivel de módulo sobreviviría entre casos. */
export function _limpiarCachePrompt(): void {
  cache.clear();
}

/** Estado de los dos prompts, para el endpoint de diagnóstico. Sin exponer el contenido. */
export function estadoDeLosPrompts(): Record<string, { presente: boolean; ruta: string; hash: string; lineas: number }> {
  const salida: Record<string, { presente: boolean; ruta: string; hash: string; lineas: number }> = {};
  for (const id of Object.keys(CAMPOS) as AgenteTextoId[]) {
    const p = cargarPromptAgente(id);
    salida[id] = { presente: p.presente, ruta: p.ruta, hash: p.hash, lineas: p.lineas };
  }
  return salida;
}
