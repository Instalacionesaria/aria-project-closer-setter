/**
 * La pasada diaria del carril amarillo, para UNA empresa.
 *
 * Corre con la empresa ya activa en el contexto (`conCredenciales`), igual que el resto de los
 * caminos de máquina. El cron que la invoca por empresa está en `api/auditor-amarillo.ts`.
 *
 * ── El orden importa, y es el del spec ────────────────────────────────
 *
 *   1. Candidatos del día: conversación con actividad hoy, bot activo, sin hallazgo rojo.
 *   2. Agrupar por señal heurística y elegir UN patrón: el más repetido; si empatan, el más
 *      reciente.
 *   3. **Antes de gastar**, descartar: si ya hay un amarillo abierto con el mismo `error_code`,
 *      el mismo agente y el mismo `prompt_hash`, no se llama al modelo.
 *   4. Si sobrevive: una llamada.
 *
 * El paso 3 es el que sostiene el presupuesto. Sin él, un patrón que el técnico todavía no
 * arregló volvería a costar una inferencia todos los días para decir lo mismo.
 *
 * ── El tope duro ──────────────────────────────────────────────────────
 *
 * Un amarillo por empresa y por agente, por día. No es una cadencia suave que se acelera cuando
 * hay mucho para decir: es un techo. Un techo se razona y se presupuesta; una cadencia suave hay
 * que simularla para saber cuánto sale.
 */

import { db, orgActiva } from "../repo.js";
import { env } from "../env.js";
import { credencialesActivas } from "../credenciales.js";
import { cargarPromptAgente } from "../promptAgente.js";
import { conversacionDeContacto, mensajesDeConversacionPaginado } from "../ghl/lectura.js";
import {
  AUDITORES_ACTIVOS,
  MODELO_AUDITOR,
  TERRITORIOS,
  armarTranscript,
  clasificarMensajes,
  elAgenteAtiende,
  territorioDe,
  type AgenteTextoId,
  type MensajeClasificado,
} from "../analizador.js";
import { alarmasDe, type SenalHeuristica } from "./heuristicas.js";
import { buscarMejora, CRITERIO_AMARILLO } from "./amarillo.js";

export interface ResultadoAmarilloDiario {
  corrio: boolean;
  motivo: string;
  /** Contactos con actividad hoy que pasaron los filtros. */
  candidatos: number;
  /** La señal elegida del día, si hubo alguna. */
  senal?: SenalHeuristica;
  /** `true` si se llegó a llamar al modelo. Sirve para leer el gasto del día. */
  gasto: boolean;
  hallazgo?: { errorCode: string; titulo: string; agenteId: AgenteTextoId };
}

/** Un candidato del día, con el momento de su último mensaje para desempatar. */
export interface Candidato {
  contactId: string;
  cuando: number;
}

/**
 * El patrón del día: la señal **más repetida**; si empatan, la que tenga el candidato más
 * reciente. Y dentro de la señal elegida, el contacto más reciente.
 *
 * Se saca de `pasadaAmarilla` para poder probarlo: es una regla de negocio con un desempate, y un
 * desempate mal escrito no rompe nada visible —siempre elige *algo*—, solo elige mal todos los
 * días. Ese es el tipo de error que no aparece hasta que alguien compara a mano.
 */
export function elegirPatron(
  porSenal: Map<SenalHeuristica, Candidato[]>,
): { senal: SenalHeuristica; elegido: Candidato } | null {
  const masReciente = (cs: Candidato[]) => Math.max(...cs.map((c) => c.cuando));

  const entradas = [...porSenal.entries()].filter(([, cs]) => cs.length > 0);
  if (entradas.length === 0) return null;

  const [senal, grupo] = entradas.sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return masReciente(b[1]) - masReciente(a[1]);
  })[0];

  return { senal, elegido: [...grupo].sort((a, b) => b.cuando - a.cuando)[0] };
}

/**
 * Medianoche de hoy en la zona de la empresa, en epoch ms.
 *
 * Exportada para el test: el cálculo del borde del día es el que decide qué conversaciones entran,
 * y en un huso negativo un error de signo mueve la ventana un día entero sin que nada falle.
 */
export function inicioDelDia(zona: string, ahora = new Date()): number {
  // `en-CA` da `YYYY-MM-DD`, que es lo que hace falta para reconstruir el borde del día.
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(ahora);
  // El offset de la zona a esta hora, para pasar de "medianoche local" a UTC sin tabla de husos.
  const enZona = new Date(ahora.toLocaleString("en-US", { timeZone: zona }));
  const offsetMs = ahora.getTime() - enZona.getTime();
  return new Date(`${fecha}T00:00:00`).getTime() + offsetMs;
}

/**
 * `dryRun` recorre todo el camino de decisión —candidatos, tope, señal, descarte— y **se detiene
 * justo antes de llamar al modelo**. Es la misma opción que ya tiene el carril rojo, y sirve para
 * lo mismo: verificar contra datos reales de producción sin gastar ni escribir.
 */
export async function pasadaAmarilla(opts: { dryRun?: boolean } = {}): Promise<ResultadoAmarilloDiario> {
  const zona = env.zonaHoraria();
  const desde = new Date(inicioDelDia(zona)).toISOString();

  /* ── 1. Los candidatos del día ─────────────────────────────────────── */
  const { data: filas } = await db()
    .from("closer_contactos")
    .select("ghl_contact_id, tags, last_message_ghl_at")
    .gte("last_message_ghl_at", desde)
    .order("last_message_ghl_at", { ascending: false })
    .limit(200);

  const conActividad = (filas ?? []) as Array<{
    ghl_contact_id: string;
    tags: string[] | null;
    last_message_ghl_at: string | null;
  }>;

  const candidatos = conActividad.filter((c) => {
    const tags = c.tags ?? [];
    // `elAgenteAtiende` es la MISMA regla del carril rojo, escotilla incluida. Ver su comentario:
    // con el filtro estricto este cron matcheaba cero contactos en producción, en silencio.
    if (!elAgenteAtiende(tags)) return false;
    const territorio = territorioDe(tags);
    /**
     * El territorio se filtra ACÁ y no después de elegir el patrón. Si un contacto de un agente
     * que no se audita todavía (`AUDITORES_ACTIVOS` hoy solo lleva `appointment-flow-ai`) llegara
     * a la elección y ganara, la corrida del día se perdería entera: hay un solo patrón por día, y
     * ese patrón sería inescribible.
     */
    return territorio !== null && AUDITORES_ACTIVOS.includes(TERRITORIOS[territorio].agenteId);
  });

  if (candidatos.length === 0) {
    return { corrio: true, motivo: "sin conversaciones con actividad hoy", candidatos: 0, gasto: false };
  }

  /* ── El tope duro, ANTES de mirar nada ─────────────────────────────── */
  /**
   * Se consulta primero por la misma razón que el descarte del paso 3: si el techo ya está
   * alcanzado, todo lo que venga después es trabajo que no se va a poder escribir.
   *
   * ── `criterio`, y no solo `severidad` ─────────────────────────────
   *
   * El carril ROJO también produce hallazgos de severidad `amarillo`: son los que encuentra de
   * paso y que no piden intervención. Contarlos acá bloquearía este carril con trabajo ajeno — y
   * de hecho lo hizo: el primer dry run contra producción devolvió "tope alcanzado" por dos
   * amarillos del rojo, de criterios `ninguno` y `promesa_incorrecta`.
   *
   * `criterio = 'acompanamiento'` es la marca que distingue a los de este carril. Es el único
   * lugar que la escribe.
   */
  const { data: deHoy } = await db()
    .from("closer_hallazgo_agente")
    .select("agente_id")
    .eq("severidad", "amarillo")
    .eq("criterio", CRITERIO_AMARILLO)
    .gte("detectado_el", desde);

  const topeAlcanzado = new Set((deHoy ?? []).map((h) => (h as { agente_id: string }).agente_id));
  const agentesDisponibles = AUDITORES_ACTIVOS.filter((a) => !topeAlcanzado.has(a));
  if (agentesDisponibles.length === 0) {
    return {
      corrio: true,
      motivo: "tope del día alcanzado para todos los agentes activos",
      candidatos: candidatos.length,
      gasto: false,
    };
  }

  /* ── Los que YA tienen rojo hoy quedan fuera ───────────────────────── */
  const { data: rojos } = await db()
    .from("closer_hallazgo_agente")
    .select("ghl_contact_id")
    .eq("severidad", "rojo")
    .gte("detectado_el", desde);

  const conRojo = new Set((rojos ?? []).map((h) => (h as { ghl_contact_id: string }).ghl_contact_id));
  const limpios = candidatos.filter((c) => !conRojo.has(c.ghl_contact_id));
  if (limpios.length === 0) {
    return {
      corrio: true,
      motivo: "todas las conversaciones del día ya tienen hallazgo rojo",
      candidatos: candidatos.length,
      gasto: false,
    };
  }

  /* ── 2. Agrupar por señal heurística y elegir un patrón ────────────── */
  /**
   * Las señales salen de `closer_mensajes`, no de GHL: elegir a quién mirar no puede costar una
   * llamada por candidato. La única llamada a GHL del día es la del elegido, más abajo.
   */
  const porSenal = new Map<SenalHeuristica, Candidato[]>();
  for (const c of limpios) {
    const mensajes = await mensajesDelCache(c.ghl_contact_id);
    const cuando = c.last_message_ghl_at ? Date.parse(c.last_message_ghl_at) : 0;
    for (const a of alarmasDe(mensajes)) {
      const lista = porSenal.get(a.senal) ?? [];
      lista.push({ contactId: c.ghl_contact_id, cuando });
      porSenal.set(a.senal, lista);
    }
  }

  if (porSenal.size === 0) {
    return {
      corrio: true,
      motivo: "ninguna conversación del día levantó señal: nada para mejorar hoy",
      candidatos: limpios.length,
      gasto: false,
    };
  }

  const patron = elegirPatron(porSenal)!;
  const { senal, elegido } = patron;

  /* ── El territorio y el agente del elegido ─────────────────────────── */
  const fila = limpios.find((c) => c.ghl_contact_id === elegido.contactId)!;
  const territorio = territorioDe(fila.tags ?? [])!;
  const agenteId = TERRITORIOS[territorio].agenteId;

  // El tope por agente. El filtro de arriba ya garantizó que `agenteId` esté en AUDITORES_ACTIVOS,
  // así que llegar acá solo puede significar que ese agente ya usó su amarillo de hoy.
  if (!agentesDisponibles.includes(agenteId)) {
    return {
      corrio: true,
      motivo: `${agenteId} ya tiene su amarillo de hoy`,
      candidatos: limpios.length,
      senal,
      gasto: false,
    };
  }

  const prompt = cargarPromptAgente(agenteId);

  /* ── 3. El descarte, ANTES de gastar ───────────────────────────────── */
  /**
   * Se descarta por `(error_code, agente, prompt_hash)`, y el `prompt_hash` es la parte que la
   * hace correcta: si el técnico editó el prompt, la misma recomendación sobre el prompt NUEVO sí
   * es información —dice que el arreglo no alcanzó—. Sin el hash, un patrón arreglado quedaría
   * silenciado para siempre.
   *
   * Lo que no se puede es descartar por `error_code` antes de tenerlo: el código lo produce el
   * modelo. Así que se descarta por el conjunto de códigos abiertos de ese agente con ese hash, y
   * si el modelo devuelve uno de ellos, no se escribe. La llamada ya se gastó — es el costo de no
   * poder adivinar el código —, pero el hallazgo duplicado no llega a la pestaña.
   *
   * El ahorro de verdad está un paso antes: si TODAS las señales del día ya tienen amarillo
   * abierto sobre este prompt, no se llama. Es el caso común de un patrón que el técnico todavía
   * no tocó.
   */
  const { data: abiertos } = await db()
    .from("closer_hallazgo_agente")
    .select("error_code")
    .eq("severidad", "amarillo")
    // Mismo motivo que el tope: los amarillos del carril rojo no son duplicados de éste.
    .eq("criterio", CRITERIO_AMARILLO)
    .eq("estado", "activo")
    .eq("agente_id", agenteId)
    .eq("prompt_hash", prompt.hash);

  const yaAbiertos = new Set((abiertos ?? []).map((h) => (h as { error_code: string }).error_code));

  if (opts.dryRun) {
    return {
      corrio: true,
      motivo: `dry run: llamaría al modelo por ${elegido.contactId} (${agenteId}, ${yaAbiertos.size} códigos ya abiertos sobre este prompt)`,
      candidatos: limpios.length,
      senal,
      gasto: false,
    };
  }

  /* ── 4. La única llamada al modelo del día ─────────────────────────── */
  const conversationId = await conversacionDeContacto(elegido.contactId);
  if (!conversationId) {
    return { corrio: true, motivo: "el elegido no tiene conversación en GHL", candidatos: limpios.length, senal, gasto: false };
  }

  const { mensajes, truncado } = await mensajesDeConversacionPaginado(conversationId, { limite: 100, paginas: 2 });
  const clasificados = clasificarMensajes(mensajes);
  const transcript = armarTranscript(clasificados, truncado);

  const apiKey = credencialesActivas()?.anthropicKey;
  if (!apiKey) {
    return { corrio: false, motivo: "la empresa no tiene key de Anthropic cargada", candidatos: limpios.length, senal, gasto: false };
  }

  const resultado = await buscarMejora({
    apiKey,
    contexto: TERRITORIOS[territorio].contexto,
    prompt: prompt.presente ? prompt.texto : "(sin prompt cargado)",
    transcript,
  });

  if (!resultado.ok) {
    return { corrio: false, motivo: resultado.motivo, candidatos: limpios.length, senal, gasto: true };
  }
  if (!resultado.mejora) {
    return { corrio: true, motivo: resultado.motivo, candidatos: limpios.length, senal, gasto: true };
  }

  const mejora = resultado.mejora;
  if (yaAbiertos.has(mejora.errorCode)) {
    return {
      corrio: true,
      motivo: `"${mejora.errorCode}" ya está abierto sobre este mismo prompt: no se duplica`,
      candidatos: limpios.length,
      senal,
      gasto: true,
    };
  }

  /* ── El hallazgo. Sin análisis padre: el amarillo no es un veredicto ─ */
  /**
   * `analisis_id` es NOT NULL, así que el amarillo necesita una fila en `closer_analisis_agente`.
   * Se escribe con `fallo: false` y `disparo: 'amarillo'`: es lo que hace que el panel de
   * sentimiento y la cola roja lo ignoren. Un amarillo con `fallo: true` le apagaría el bot a
   * alguien, que es exactamente lo que este carril NO hace.
   */
  const { data: analisis, error: errAnalisis } = await db()
    .from("closer_analisis_agente")
    .insert({
      agente_id: agenteId,
      ghl_contact_id: elegido.contactId,
      conversation_id: conversationId,
      fallo: false,
      criterio: CRITERIO_AMARILLO,
      motivo: null,
      sentimiento: "neutral",
      // La constante, no el literal: si mañana cambia, los dos carriles cambian juntos.
      modelo: MODELO_AUDITOR,
      ia_cache_al_analizar: clasificados.filter((m) => m.autor === "agente_ia").length,
      prompt_hash: prompt.hash,
      auditable: true,
      disparo: "amarillo",
      alarmas: [senal],
    })
    .select("id")
    .single();

  if (errAnalisis || !analisis) {
    return { corrio: false, motivo: `no se pudo guardar el análisis: ${errAnalisis?.message}`, candidatos: limpios.length, senal, gasto: true };
  }

  const { error: errHallazgo } = await db()
    .from("closer_hallazgo_agente")
    .insert({
      analisis_id: (analisis as { id: string }).id,
      agente_id: agenteId,
      ghl_contact_id: elegido.contactId,
      error_code: mejora.errorCode,
      titulo: mejora.titulo,
      categoria: mejora.categoria,
      severidad: "amarillo",
      criterio: CRITERIO_AMARILLO,
      diagnostico: mejora.diagnostico || null,
      // El amarillo NO devuelve corrección de prompt: redactar el reemplazo es la parte cara del
      // veredicto y el técnico no la pidió. Las tres columnas quedan en null a propósito.
      fragmento_prompt: null,
      prompt_seccion: null,
      correccion_tipo: null,
      correccion: null,
      prompt_hash: prompt.hash,
      evidencia_usuario: mejora.evidenciaContacto,
      evidencia_ia: mejora.evidenciaIa,
      evidencia_el: new Date().toISOString(),
    });

  if (errHallazgo) {
    return { corrio: false, motivo: `no se pudo guardar el hallazgo: ${errHallazgo.message}`, candidatos: limpios.length, senal, gasto: true };
  }

  console.log(`[amarillo] ${orgActiva()} · ${senal} → ${mejora.errorCode}`);
  return {
    corrio: true,
    motivo: "hallazgo amarillo registrado",
    candidatos: limpios.length,
    senal,
    gasto: true,
    hallazgo: { errorCode: mejora.errorCode, titulo: mejora.titulo, agenteId },
  };
}

/** Los mensajes de un contacto desde la caché. Mismo criterio que el nivel 0 del carril rojo. */
async function mensajesDelCache(ghlContactId: string): Promise<MensajeClasificado[]> {
  const { data } = await db()
    .from("closer_mensajes")
    .select("autor, direccion, body, timestamp_ghl")
    .eq("ghl_contact_id", ghlContactId)
    .order("timestamp_ghl", { ascending: false })
    .limit(40);

  const filas = (data ?? []) as Array<{
    autor: string | null;
    direccion: string | null;
    body: string | null;
    timestamp_ghl: string | null;
  }>;

  return filas.reverse().map((m) => ({
    autor: (m.autor ?? (m.direccion === "inbound" ? "contacto" : "desconocido")) as MensajeClasificado["autor"],
    texto: m.body ?? "",
    cuando: m.timestamp_ghl ? new Date(m.timestamp_ghl).getTime() : 0,
    sinTexto: !m.body?.trim(),
  }));
}
