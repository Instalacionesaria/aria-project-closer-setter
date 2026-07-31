/**
 * `GET /api/closer/cockpit` — el dinero real del closer, leído de las oportunidades de GHL.
 *
 * Por qué existe: hasta acá el cockpit de Inicio derivaba de `closerStore`, y eso alcanzaba
 * mientras todo era semilla. Con la app conectada dejó de alcanzar por un motivo concreto:
 * los contactos reales entran al store por `polling-closer-pipeline`, que lee
 * `POST /contacts/search` — y esa respuesta trae tags, no plata. Un contacto real con
 * `venta_ganada` aterriza correctamente en la etapa Ganado y suma +1 a "Ventas", pero aporta
 * $0 al Cash Collected, porque nadie leyó nunca su Opportunity Value. El cockpit contaba las
 * ventas reales y cobraba solo las de mentira.
 *
 * El monto de una venta vive en el **Opportunity Value** (decisión de Fabio, 2026-07-30), así
 * que la única fuente honesta es el pipeline de oportunidades.
 *
 * ── Por qué NO se lee contacto por contacto ──
 *
 * `buscarOportunidadesAbiertas()` (`api/_lib/ghl/real.ts`) resuelve UN contacto por llamada, y
 * ya existe. Reusarla acá habría costado una llamada por contacto en Ganado: con 100 contactos
 * trabajados son 100 llamadas por refresco, exactamente el patrón de fan-out que
 * `docs/COSTOS-Y-POLLING.md` señala como el techo real del sistema (el límite de GHL, no la
 * factura de Vercel).
 *
 * `GET /opportunities/search` filtra por pipeline y devuelve `monetaryValue` y
 * `pipelineStageId` en la propia lista: todo el dinero entra en 2 llamadas paginadas, sin
 * importar cuántos contactos haya.
 *
 * ── Se agrupa por ETAPA, no por `status` (verificado contra la cuenta real, 2026-07-31) ──
 *
 * La versión anterior de este archivo filtraba `status=won` para el Cash Collected. Contra la
 * cuenta real eso devolvía **0 oportunidades y $0**, teniendo un trato de $1.000 parado en la
 * etapa GANADO: en GHL la etapa y el `status` son dos cosas independientes, y el workflow que
 * mueve el contacto a GANADO por el tag `venta_ganada` NO marca la oportunidad como `won`.
 *
 * Confiar en `status` habría reportado "$0 cobrado" con ventas reales cerradas — el modo de
 * falla más caro posible, porque un cero se lee como "no vendimos" y no como "no supimos leer".
 * La etapa es lo que el tool ya usa como verdad en todas las demás vistas (`etapaDesdeTags`),
 * así que es también la única fuente coherente para el dinero.
 *
 * Lo que NO hace: sumar las semillas `EJEMPLO` (no existen en GHL) ni armar textos de UI.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../_lib/env.js";

const BASE = "https://services.leadconnectorhq.com";
/** Misma versión del contrato v2 que usan `real.ts`, `lectura.ts` y `pipeline.ts`. */
const VERSION = "2021-07-28";

/** Tope por página del search de oportunidades. */
const POR_PAGINA = 100;

/**
 * Freno de emergencia, no el límite esperado: 10 páginas = 1.000 oportunidades.
 * Si la paginación cambiara de forma y el bucle dejara de avanzar, esto lo corta y la
 * respuesta lo dice (`cobertura.completo: false`) en vez de colgar la función.
 */
const TOPE_PAGINAS = 10;

/**
 * Nombres de etapa que identifican al pipeline del CLOSER.
 *
 * Verificado contra la cuenta real el 2026-07-31: tiene **11 pipelines**, no dos (CLAUDE.md §2
 * dice "dos pipelines" y describe el diseño, no el inventario — hay nueve heredados: ScalingUSA,
 * Lead Forms, Demo Roleplay, cuatro de público frío/tibio/caliente, Pagina WEB, Seguimiento
 * Comercial). De los 11, **exactamente uno** tiene alguna de estas dos etapas: `$ Appointment
 * Flow`. El de setter (`$ Lead Flow`) no las tiene, así que no hay empate.
 *
 * Hace falta distinguirlo porque en el pipeline del setter un trato cerrado significa "agendado"
 * o "low-ticket vendido": sumar los dos metería ventas de $97 dentro del Cash Collected
 * high-ticket del closer — el mismo tipo de mezcla que §44 vino a arreglar del lado de los KPIs.
 */
const ETAPAS_DEL_CLOSER = ["ganado", "cierre en curso"];

/** La etapa cuyo total es el Cash Collected. */
const ETAPA_GANADO = "ganado";

/**
 * Etapas cuyo total alimenta "Acuerdos" (§6.A: seña o promesa, todavía sin pago).
 *
 * Son DOS porque la cuenta real tiene las dos y ningún documento dice a cuál mueve el workflow
 * del tag `adelanto_ganado`: "Cierre en curso" (el nombre que usa el contrato y el front) y
 * "Adelanto/Segna". Las dos significan lo mismo para el negocio, así que se suman ambas —
 * elegir una a ciegas dejaría plata acordada fuera del total sin que nada lo indique.
 */
const ETAPAS_ACUERDO = ["cierre en curso", "adelanto/segna"];

/**
 * Una oportunidad en estos estados NO cuenta, esté en la etapa que esté: alguien la marcó
 * perdida o abandonada a mano, y eso pesa más que la columna donde quedó la tarjeta.
 */
const STATUS_MUERTOS = ["lost", "abandoned"];

/**
 * Compara nombres de etapa sin que un acento o una mayúscula decidan de dónde sale el dinero.
 *
 * `NFD` separa cada letra acentuada en letra + marca de acento, y el filtro deja solo ASCII
 * imprimible: así "GANADO", "Ganado" y "Ganádo" caen en el mismo string. Se descartan los
 * no-ASCII en vez de listar el rango de diacríticos porque el rango obliga a escribir
 * caracteres combinantes en el fuente, invisibles en cualquier diff.
 */
const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();

async function ghlGet(ruta: string): Promise<any> {
  const r = await fetch(`${BASE}${ruta}`, {
    headers: {
      Authorization: `Bearer ${env.ghlApiKey()}`,
      Version: VERSION,
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    const detalle = await r.text();
    throw new Error(`GHL ${r.status} en GET ${ruta.split("?")[0]}: ${detalle.slice(0, 300)}`);
  }
  return r.json();
}

interface PipelineElegido {
  id: string;
  nombre: string;
  /** stageId → nombre de etapa ya normalizado. */
  etapas: Map<string, string>;
}

/**
 * Encuentra el pipeline del closer entre los de la cuenta.
 *
 * Se prefiere `GHL_CLOSER_PIPELINE_ID` cuando está configurada: un id explícito no se puede
 * equivocar, y es la vía para un cliente cuyo pipeline se llame distinto. Sin ella, se
 * identifica por nombre de etapa — y si NINGUNO o MÁS DE UNO califica, se devuelve error en
 * vez de elegir.
 *
 * Ese "no adivinar" es la misma regla que ya gobierna `fijarValorOportunidad`: cuando el
 * destino de una operación de dinero es ambiguo, se para y se explica. Elegir "el primero que
 * devuelva GHL" acá no rompe nada visible — reporta el dinero del pipeline equivocado, que es
 * la falla más difícil de detectar de todas.
 */
async function elegirPipeline(): Promise<
  { ok: true; pipeline: PipelineElegido; comoSeEligio: string } | { ok: false; error: string }
> {
  const locationId = env.ghlLocationId();
  const datos = await ghlGet(`/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`);
  const pipelines = (Array.isArray(datos?.pipelines) ? datos.pipelines : []) as any[];

  if (pipelines.length === 0) {
    return { ok: false, error: "La cuenta de GHL no devolvió ningún pipeline." };
  }

  const mapaEtapas = (p: any): Map<string, string> => {
    const m = new Map<string, string>();
    for (const e of (Array.isArray(p?.stages) ? p.stages : []) as any[]) {
      if (e?.id) m.set(String(e.id), normalizar(String(e?.name ?? "")));
    }
    return m;
  };
  const listar = () => pipelines.map((x) => `${x?.name} (${x?.id})`).join(", ");

  const forzado = process.env.GHL_CLOSER_PIPELINE_ID;
  if (forzado) {
    const p = pipelines.find((x) => x?.id === forzado);
    if (!p) {
      return {
        ok: false,
        error: `GHL_CLOSER_PIPELINE_ID apunta a "${forzado}", que no existe en esta cuenta. Pipelines: ${listar()}.`,
      };
    }
    return {
      ok: true,
      pipeline: { id: p.id, nombre: String(p.name ?? "sin nombre"), etapas: mapaEtapas(p) },
      comoSeEligio: "GHL_CLOSER_PIPELINE_ID",
    };
  }

  const candidatos = pipelines.filter((p) => {
    const nombres = [...mapaEtapas(p).values()];
    return ETAPAS_DEL_CLOSER.some((e) => nombres.includes(e));
  });

  if (candidatos.length === 0) {
    return {
      ok: false,
      error:
        `Ningún pipeline tiene una etapa "${ETAPAS_DEL_CLOSER.join('" ni "')}", así que no se puede ` +
        `saber cuál es el del closer sin arriesgar mezclar el dinero del setter. Configurá ` +
        `GHL_CLOSER_PIPELINE_ID. Pipelines: ${listar()}.`,
    };
  }
  if (candidatos.length > 1) {
    return {
      ok: false,
      error:
        `Más de un pipeline califica como el del closer (${candidatos.map((x) => `${x?.name} (${x?.id})`).join(", ")}). ` +
        `Configurá GHL_CLOSER_PIPELINE_ID para desempatar.`,
    };
  }

  const p = candidatos[0];
  return {
    ok: true,
    pipeline: { id: p.id, nombre: String(p.name ?? "sin nombre"), etapas: mapaEtapas(p) },
    comoSeEligio: "nombre de etapa",
  };
}

interface OportunidadLeida {
  id: string;
  monto: number;
  etapaId: string | null;
  status: string;
  /** Necesario para que el front pueda cruzar el dinero con los contactos que SÍ muestra. */
  contactId: string | null;
}

/**
 * Todas las oportunidades del pipeline, paginadas. Sin filtro de `status`: la etapa es la
 * verdad (ver el encabezado del archivo), y los estados muertos se descartan después.
 *
 * Se dedupe por id y se corta si una página no aporta nada nuevo: si GHL ignorara el parámetro
 * de página devolvería siempre la primera, y sin este corte el bucle sumaría el mismo dinero
 * diez veces. Un Cash Collected inflado 10× es peor que uno incompleto, porque el incompleto
 * se nota y el inflado se celebra.
 */
async function leerOportunidades(
  pipelineId: string,
): Promise<{ oportunidades: OportunidadLeida[]; completo: boolean; motivo?: string }> {
  const locationId = env.ghlLocationId();
  const vistas = new Map<string, OportunidadLeida>();
  let pagina = 1;

  while (pagina <= TOPE_PAGINAS) {
    const params = new URLSearchParams({
      location_id: locationId,
      pipeline_id: pipelineId,
      limit: String(POR_PAGINA),
      page: String(pagina),
    });

    let datos: any;
    try {
      datos = await ghlGet(`/opportunities/search?${params.toString()}`);
    } catch (e) {
      // Si la primera página falla no hay nada que reportar: que suba y sea un 502 honesto.
      if (pagina === 1) throw e;
      // Si falló después de leer algo, se devuelve lo leído ROTULADO como parcial.
      return {
        oportunidades: [...vistas.values()],
        completo: false,
        motivo: `La página ${pagina} de oportunidades falló: ${(e as Error).message}`,
      };
    }

    const bruto = datos?.opportunities ?? datos?.opportunity ?? [];
    const lote = (Array.isArray(bruto) ? bruto : [bruto]).filter((o: any) => o?.id) as any[];
    if (lote.length === 0) return { oportunidades: [...vistas.values()], completo: true };

    const antes = vistas.size;
    for (const o of lote) {
      const monto = Number(o.monetaryValue ?? o.monetary_value ?? 0);
      vistas.set(o.id, {
        id: o.id,
        monto: Number.isFinite(monto) && monto > 0 ? monto : 0,
        etapaId: o.pipelineStageId ?? o.pipeline_stage_id ?? null,
        status: String(o.status ?? "open").toLowerCase(),
        contactId: o.contactId ?? o.contact_id ?? o.contact?.id ?? null,
      });
    }

    if (vistas.size === antes) {
      return {
        oportunidades: [...vistas.values()],
        completo: false,
        motivo: `La página ${pagina} no trajo ninguna oportunidad nueva — GHL parece ignorar el parámetro de página.`,
      };
    }
    if (lote.length < POR_PAGINA) return { oportunidades: [...vistas.values()], completo: true };
    pagina += 1;
  }

  return {
    oportunidades: [...vistas.values()],
    completo: false,
    motivo: `Se alcanzó el techo de ${TOPE_PAGINAS} páginas (${TOPE_PAGINAS * POR_PAGINA} oportunidades).`,
  };
}

/** Respuesta cuando no se pudo leer el dinero: ceros ROTULADOS, nunca ceros a secas. */
function sinDatos(ghlModo: string, motivo: string) {
  return {
    ok: true,
    ghlModo,
    disponible: false,
    motivo,
    ganado: { monto: 0, cantidad: 0, porContacto: [], montoSinContacto: 0 },
    cierre: { monto: 0, cantidad: 0, porContacto: [], montoSinContacto: 0 },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Usá GET." });
  }

  if (env.ghlModo() === "stub") {
    return res.status(200).json(sinDatos("stub", "Sin credenciales de GHL: no hay oportunidades que leer."));
  }

  try {
    const elegido = await elegirPipeline();
    if (!elegido.ok) {
      // 200 y no 5xx: la función anduvo bien, lo que falta es configuración. Un 5xx haría que el
      // front lo trate como caída de red y lo esconda, cuando esto necesita ser leído.
      return res.status(200).json(sinDatos("real", elegido.error));
    }

    const { pipeline, comoSeEligio } = elegido;
    const leidas = await leerOportunidades(pipeline.id);

    const vivas = leidas.oportunidades.filter((o) => !STATUS_MUERTOS.includes(o.status));
    const enEtapas = (nombres: string[]) =>
      vivas.filter((o) => (o.etapaId ? nombres.includes(pipeline.etapas.get(o.etapaId) ?? "") : false));

    const ganadas = enEtapas([ETAPA_GANADO]);
    const acuerdos = enEtapas(ETAPAS_ACUERDO);
    const sumar = (ops: OportunidadLeida[]) => ops.reduce((s, o) => s + o.monto, 0);

    /**
     * El desglose por contacto es lo que permite al front sumar SOLO el dinero de los contactos
     * que de hecho muestra, y es una necesidad real, no una comodidad.
     *
     * Encontrado en la cuenta el 2026-07-31: hay un trato de $1.000 parado en GANADO cuyo
     * contacto tiene únicamente el tag `no calificado` — sin `zona_closer`, así que no aparece
     * en el Pipeline, y sin `venta_ganada`, así que tampoco cuenta como venta. Sumar el total
     * de la etapa a ciegas habría puesto $1.000 en el Cash Collected que ninguna vista podía
     * explicar: exactamente el "dos números para la misma plata" que §44 vino a erradicar.
     *
     * Los tratos huérfanos como ese no se descartan en silencio ni se suman en silencio: viajan
     * identificados para que el front los excluya del total y pueda decir que existen.
     */
    const desglose = (ops: OportunidadLeida[]) =>
      ops
        .filter((o) => o.contactId)
        .map((o) => ({ contactId: o.contactId as string, monto: o.monto }));

    /** Dinero en la etapa sin contacto asociado — no se puede atribuir a nadie. */
    const sinContacto = (ops: OportunidadLeida[]) => sumar(ops.filter((o) => !o.contactId));

    const etapasPresentes = new Set(pipeline.etapas.values());
    const avisos: string[] = [];
    if (leidas.motivo) avisos.push(leidas.motivo);
    if (!etapasPresentes.has(ETAPA_GANADO)) {
      avisos.push(
        `El pipeline "${pipeline.nombre}" no tiene una etapa llamada "GANADO", así que el Cash ` +
          `Collected real no se pudo calcular.`,
      );
    }
    if (!ETAPAS_ACUERDO.some((e) => etapasPresentes.has(e))) {
      avisos.push(
        `El pipeline "${pipeline.nombre}" no tiene ninguna etapa de acuerdo ("${ETAPAS_ACUERDO.join('" / "')}"), ` +
          `así que Acuerdos no se pudo calcular desde GHL.`,
      );
    }
    /**
     * Las oportunidades sin monto se avisan en vez de sumarse como 0 en silencio: una venta
     * cargada sin Opportunity Value es la explicación de por qué el Cash Collected "va corto",
     * y sin este aviso la única pista sería un número más bajo de lo esperado.
     */
    const sinMonto = ganadas.filter((o) => o.monto === 0).length;
    if (sinMonto > 0) {
      avisos.push(
        `${sinMonto} de ${ganadas.length} oportunidades en GANADO no tienen Opportunity Value cargado ` +
          `y suman $0 al Cash Collected.`,
      );
    }

    return res.status(200).json({
      ok: true,
      ghlModo: "real",
      disponible: true,
      pipeline: { id: pipeline.id, nombre: pipeline.nombre, comoSeEligio },
      ganado: {
        monto: sumar(ganadas),
        cantidad: ganadas.length,
        porContacto: desglose(ganadas),
        montoSinContacto: sinContacto(ganadas),
      },
      cierre: {
        monto: sumar(acuerdos),
        cantidad: acuerdos.length,
        porContacto: desglose(acuerdos),
        montoSinContacto: sinContacto(acuerdos),
      },
      cobertura: { completo: leidas.completo, oportunidadesLeidas: leidas.oportunidades.length },
      ...(avisos.length > 0 ? { avisos } : {}),
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: (e as Error).message });
  }
}
