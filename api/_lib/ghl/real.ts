/**
 * Adapter real contra la API v2 de GoHighLevel (`services.leadconnectorhq.com`).
 *
 * Autenticación: Private Integration Token (`pit-...`) en el header `Authorization`, más
 * el header `Version` con la fecha del contrato de la API — GHL versiona así, y omitirlo
 * devuelve errores poco descriptivos.
 *
 * Ninguna llamada arma un literal a mano: los nombres de tags y custom fields vienen de
 * `src/lib/ghl/contrato.ts`, y `assertEnviable()` corta antes de salir si alguno no está
 * confirmado.
 */

import { env } from "../env.js";
import type {
  CampoInput,
  ContactoGhl,
  GhlPort,
  NotaInput,
  OportunidadInput,
  ResultadoGhl,
  TagsInput,
} from "./port.js";

const BASE = "https://services.leadconnectorhq.com";
/** Versión del contrato de la API v2. GHL la exige en cada request. */
const VERSION = "2021-07-28";

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.ghlApiKey()}`,
    Version: VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** 429 y 5xx se reintentan; 4xx son errores nuestros y no tiene sentido repetirlos. */
const esReintentable = (status: number) => status === 429 || status >= 500;

async function llamar(
  metodo: string,
  ruta: string,
  body?: unknown,
): Promise<{ ok: true; datos: any } | { ok: false; error: string; status: number }> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // Fallo de red: no hubo status, así que se trata como reintentable.
    return { ok: false, error: `Red: ${(e as Error).message}`, status: 0 };
  }

  const texto = await respuesta.text();
  if (!respuesta.ok) {
    return { ok: false, error: texto.slice(0, 500) || respuesta.statusText, status: respuesta.status };
  }
  try {
    return { ok: true, datos: texto ? JSON.parse(texto) : {} };
  } catch {
    return { ok: true, datos: {} };
  }
}

/* ================================================================== */
/* Catálogo de custom fields                                          */
/* ================================================================== */

/**
 * Los custom fields se escriben por id, pero el resto del código habla en las unique keys
 * del contrato. Este catálogo traduce en ambos sentidos.
 *
 * Se cachea por proceso: en una función serverless dura lo que dura la instancia caliente,
 * que es exactamente la vida útil que queremos — sin invalidación que mantener, y como
 * mucho una llamada extra por arranque en frío.
 */
let cacheCampos: { claveAId: Map<string, string>; idAClave: Map<string, string> } | null = null;

/** GHL a veces devuelve la key con prefijo `contact.` y a veces sin él. */
const normalizar = (k: string) => k.replace(/^contact\./, "").toLowerCase();

async function catalogoCampos() {
  if (cacheCampos) return cacheCampos;

  const r = await llamar("GET", `/locations/${env.ghlLocationId()}/customFields`);
  const claveAId = new Map<string, string>();
  const idAClave = new Map<string, string>();

  if (r.ok) {
    for (const f of r.datos?.customFields ?? []) {
      const clave = f.fieldKey ?? f.key;
      if (!clave || !f.id) continue;
      claveAId.set(normalizar(clave), f.id);
      idAClave.set(f.id, clave);
    }
    // Solo se cachea un catálogo que se pudo leer. Cachear el vacío convertiría un fallo de
    // red pasajero en un "el campo no existe" permanente hasta el próximo arranque.
    cacheCampos = { claveAId, idAClave };
  }

  return { claveAId, idAClave };
}

const idDeCampo = async (clave: string) => (await catalogoCampos()).claveAId.get(normalizar(clave));
const mapaIdAClave = async () => (await catalogoCampos()).idAClave;

/* ================================================================== */
/* Oportunidades                                                      */
/* ================================================================== */

/** Lo único que nos interesa de una oportunidad. El resto del objeto no se toca. */
interface OportunidadGhl {
  id: string;
  /** open | won | lost | abandoned */
  status?: string;
  pipelineId?: string;
}

type FalloLlamada = Extract<Awaited<ReturnType<typeof llamar>>, { ok: false }>;

/**
 * La oportunidad del contacto: la abierta si tiene una, y si no la más reciente.
 *
 * Dos detalles que no son paranoia gratuita:
 *
 * 1. **Los parámetros van en snake_case Y camelCase.** El search de oportunidades es el
 *    único endpoint de v2 que documenta `location_id`/`contact_id` en snake_case, mientras
 *    todo el resto de la API usa camelCase — y distintas versiones del portal muestran una
 *    forma u otra. GHL ignora los parámetros que no conoce, así que mandar los dos nombres
 *    cuesta nada y evita el modo de falla peor de todos.
 * 2. **El filtro por contacto se vuelve a aplicar acá.** Si GHL ignorara `contact_id` (que
 *    es exactamente lo que pasaría con el nombre equivocado), la búsqueda devolvería las
 *    oportunidades de TODA la location y escribiríamos el monto de una venta sobre el trato
 *    de otra persona. Un filtro local convierte ese escenario en "no tiene oportunidad",
 *    que es un error visible, en vez de una corrupción silenciosa.
 */
/**
 * Busca LA oportunidad abierta del contacto — exactamente una, o ninguna.
 *
 * Devolver `abiertas` como lista y no una elegida es deliberado: **acá no se desempata**.
 * Este producto tiene dos pipelines por diseño (Lead Flow del setter y Appointment Flow del
 * closer, CLAUDE.md §2), así que un contacto puede tener dos tratos abiertos a la vez y
 * elegir "el primero que devuelva GHL" pondría el monto de una venta high-ticket sobre el
 * trato del setter. El caller corta con un error explícito.
 *
 * Tampoco se cae a una oportunidad CERRADA cuando no hay ninguna abierta. Escenario real:
 * el contacto compró en junio (`won`, $5.000) y en julio acuerda algo nuevo; sin este
 * cuidado, registrar "Acordó comprar" con una seña de $500 haría un PUT sobre el trato de
 * junio y convertiría una venta de $5.000 en una de $500, reportando éxito.
 *
 * Es el mismo criterio que ya se aplica al no crear la oportunidad cuando no existe: si el
 * destino es ambiguo, se para y se dice, en vez de adivinar sobre dinero de otro.
 */
async function buscarOportunidadesAbiertas(
  ghlContactId: string,
): Promise<{ ok: true; abiertas: OportunidadGhl[] } | FalloLlamada> {
  const locationId = env.ghlLocationId();
  // Solo los parámetros documentados de v2 (snake_case). Mandarlos duplicados en camelCase
  // "por si acaso" es contraproducente: varios endpoints de v2 validan el query string con
  // whitelist y responden 422, que es 4xx → no reintentable → la venta falla entera por
  // culpa de la mitigación. La defensa real contra un nombre equivocado es el filtro local
  // de más abajo, que no depende de que GHL respete el parámetro.
  const params = new URLSearchParams({
    location_id: locationId,
    contact_id: ghlContactId,
    limit: "20",
  });

  const r = await llamar("GET", `/opportunities/search?${params.toString()}`);
  if (!r.ok) return r;

  // GHL devuelve `opportunities: [...]`, pero algunas respuestas traen `opportunity` suelta
  // (un objeto, no un array). Se normaliza a lista antes de filtrar: un `.filter` sobre un
  // objeto explota, y sería una excepción sin manejar en medio del registro de una venta.
  const bruto = r.datos?.opportunities ?? r.datos?.opportunity ?? [];
  const crudas = (Array.isArray(bruto) ? bruto : [bruto]) as any[];

  // El filtro local es la red de seguridad: si GHL ignorara el filtro por contacto,
  // devolvería las oportunidades de TODA la location. Se contemplan las tres formas del id
  // por la misma razón por la que se contempla `pipeline_id` abajo — la respuesta de v2 no
  // es consistente entre versiones, y quedarse corto acá descartaría todo y haría creer que
  // el contacto no tiene oportunidades.
  const delContacto = crudas.filter(
    (o) => (o?.contact?.id ?? o?.contactId ?? o?.contact_id) === ghlContactId,
  );

  const abiertas = delContacto
    .filter((o) => (o?.status ?? "open") === "open" && o?.id)
    .map((o): OportunidadGhl => ({
      id: o.id,
      status: o.status ?? "open",
      pipelineId: o.pipelineId ?? o.pipeline_id,
    }));

  return { ok: true, abiertas };
}

const aResultado = (r: Awaited<ReturnType<typeof llamar>>): ResultadoGhl =>
  r.ok
    ? { ok: true, aplicado: true, detalle: r.datos }
    : { ok: false, error: r.error, status: r.status, reintentable: r.status === 0 || esReintentable(r.status) };

export const ghlReal: GhlPort = {
  modo: "real",

  async aplicarTags({ ghlContactId, tags }: TagsInput) {
    if (tags.length === 0) return { ok: true, aplicado: false };
    return aResultado(await llamar("POST", `/contacts/${ghlContactId}/tags`, { tags }));
  },

  async removerTags({ ghlContactId, tags }: TagsInput) {
    if (tags.length === 0) return { ok: true, aplicado: false };
    // GHL acepta el cuerpo en el DELETE de tags. No es lo más ortodoxo, pero es su contrato.
    return aResultado(await llamar("DELETE", `/contacts/${ghlContactId}/tags`, { tags }));
  },

  /** Nota en el contacto. El analizador deja acá el motivo del fallo, con prefijo `[IA]`. */
  async escribirNota({ ghlContactId, cuerpo }: NotaInput) {
    if (!cuerpo.trim()) return { ok: true, aplicado: false };
    return aResultado(await llamar("POST", `/contacts/${ghlContactId}/notes`, { body: cuerpo }));
  },

  /**
   * ⚠️ El PUT de contacto **exige el id** del custom field. Mandarlo por `key` —que es como
   * lo documenta CONTRATO-GHL.md §4 y como parecía natural— devuelve **200 y no escribe
   * nada**. Comprobado el 2026-07-25 con las tres variantes sobre un contacto desechable:
   * `{key, field_value}` → 200 y el campo vacío; `{id, field_value}` → escribe; `{id, value}`
   * → escribe.
   *
   * Es justo el fallo silencioso que hace peligrosa esta integración: sin verificar
   * leyendo, el sistema habría reportado "situación guardada" durante meses.
   */
  async escribirCampo({ ghlContactId, campo, valor }: CampoInput) {
    const id = await idDeCampo(campo);
    if (!id) {
      return {
        ok: false,
        reintentable: false,
        error: `El custom field "${campo}" no existe en la location. Sin su id, GHL acepta el PUT y no escribe nada.`,
      };
    }

    const r = await llamar("PUT", `/contacts/${ghlContactId}`, {
      customFields: [{ id, field_value: valor }],
    });
    return aResultado(r);
  },

  /**
   * Escribe el monto en el **Opportunity Value** de la oportunidad del contacto.
   *
   * Son dos llamadas porque la API v2 no expone las oportunidades por contacto: primero
   * `GET /opportunities/search` para encontrarla, después `PUT /opportunities/{id}`.
   *
   * ── Se escribe SOLO si hay exactamente una oportunidad abierta ──
   *
   * Ninguna, o más de una, devuelve `ok: false` con el motivo. Las tres razones:
   *
   * - **Ninguna**: no se crea. `POST /opportunities` exige `pipelineId` y `pipelineStageId`,
   *   y este puerto no los conoce (no están en el env ni en el contrato). Elegir uno
   *   "razonable" metería el trato en un pipeline arbitrario y dispararía los workflows
   *   enganchados a ese stage — el mismo daño silencioso que ya costó caro con los custom
   *   fields por `key`.
   * - **Varias**: el producto tiene dos pipelines por diseño (§2), así que un contacto puede
   *   tener el trato del setter y el del closer abiertos a la vez. Elegir uno al azar pone
   *   el monto de una venta high-ticket sobre el trato equivocado.
   * - **Solo cerradas**: pisar una `won` le cambia el monto a una venta ya cobrada. Un
   *   contacto que compró en junio por $5.000 y en julio deja una seña de $500 terminaría
   *   con una venta de $5.000 convertida en una de $500, y con `aplicado: true`.
   *
   * ── Por qué el PUT manda más que `monetaryValue` ──
   *
   * `pipelineId` se reenvía tal cual vino del search porque algunas versiones del endpoint
   * lo validan como obligatorio en el cuerpo; mandar el mismo valor que ya tiene es un
   * no-op. `status` solo se toca cuando la venta está cobrada (`ganada` → `won`); si no, no
   * se manda, para no reabrir ni cerrar nada por accidente.
   *
   * ── El 200 no alcanza ──
   *
   * Se relee `monetaryValue` de la respuesta del PUT y se compara con lo que se quiso
   * escribir. En esta integración un 2xx no prueba escritura (§50.5: el custom field por
   * `key` devuelve 200 y no escribe), y acá se trata de dinero. Sin coincidencia se
   * devuelve `aplicado: false`, nunca un éxito sin evidencia.
   */
  async fijarValorOportunidad({ ghlContactId, monto, ganada }: OportunidadInput) {
    if (!Number.isFinite(monto) || monto < 0) {
      return {
        ok: false as const,
        reintentable: false,
        error: `Monto inválido para el Opportunity Value: ${monto}. Se esperaba un número finito y no negativo.`,
      };
    }

    const busqueda = await buscarOportunidadesAbiertas(ghlContactId);
    if (!busqueda.ok) return aResultado(busqueda);

    const { abiertas } = busqueda;

    if (abiertas.length === 0) {
      return {
        ok: false as const,
        reintentable: false,
        error:
          `El contacto ${ghlContactId} no tiene ninguna oportunidad ABIERTA en GHL, así que no hay ` +
          `dónde escribir el monto sin pisar un trato ya cerrado. Crearla requiere pipelineId y ` +
          `stageId, que este puerto no conoce: hay que abrir la oportunidad en GHL y reintentar.`,
      };
    }

    if (abiertas.length > 1) {
      const detalle = abiertas.map((o) => `${o.id}${o.pipelineId ? ` (pipeline ${o.pipelineId})` : ""}`).join(", ");
      return {
        ok: false as const,
        reintentable: false,
        error:
          `El contacto ${ghlContactId} tiene ${abiertas.length} oportunidades abiertas y no hay forma ` +
          `de saber cuál corresponde a este resultado: ${detalle}. No se escribe el monto para no ` +
          `ponerlo sobre el trato equivocado — hay que cerrar las que no correspondan y reintentar.`,
      };
    }

    const op = abiertas[0];
    const cuerpo: Record<string, unknown> = { monetaryValue: monto };
    if (op.pipelineId) cuerpo.pipelineId = op.pipelineId;
    if (ganada) cuerpo.status = "won";

    const r = await llamar("PUT", `/opportunities/${op.id}`, cuerpo);
    if (!r.ok) return aResultado(r);

    // Verificación de escritura: si GHL no devuelve el valor o no coincide, no se afirma
    // que se aplicó. `ok: true` porque la llamada no falló, `aplicado: false` porque no hay
    // prueba de que el dinero haya quedado escrito.
    const escrito = Number(r.datos?.opportunity?.monetaryValue ?? r.datos?.monetaryValue);
    if (!Number.isFinite(escrito) || escrito !== monto) {
      return {
        ok: true as const,
        aplicado: false,
        detalle: {
          oportunidadId: op.id,
          montoEnviado: monto,
          montoLeido: Number.isFinite(escrito) ? escrito : null,
          aviso:
            "GHL respondió 2xx pero el monto releído no coincide con el enviado. No se puede " +
            "afirmar que el Opportunity Value quedó escrito.",
        },
      };
    }

    return { ok: true as const, aplicado: true, detalle: { oportunidadId: op.id, monto: escrito } };
  },

  async obtenerContacto(ghlContactId: string): Promise<ContactoGhl | null> {
    const r = await llamar("GET", `/contacts/${ghlContactId}`);
    if (!r.ok) return null;

    const c = r.datos?.contact ?? r.datos;
    if (!c?.id) return null;

    // Al leer, GHL devuelve `{ id, value }` — sin la key. Se traduce de vuelta para que el
    // resto del código siga hablando en las unique keys del contrato y no en ids opacos.
    const porId = await mapaIdAClave();
    const customFields: Record<string, string> = {};
    for (const f of c.customFields ?? []) {
      const clave = porId.get(f.id) ?? f.key ?? f.id;
      if (clave) customFields[clave] = f.field_value ?? f.value ?? "";
    }

    return {
      id: c.id,
      nombre: c.contactName ?? [c.firstName, c.lastName].filter(Boolean).join(" ") ?? "",
      telefono: c.phone ?? undefined,
      email: c.email ?? undefined,
      tags: c.tags ?? [],
      customFields,
    };
  },

  /**
   * `POST /contacts/search` con filtro por tag — es el único endpoint de v2 que permite
   * filtrar; el `GET /contacts/` no acepta tags y obligaría a traer la lista entera y
   * filtrar acá.
   */
  async buscarPorTag(tag: string, limite = 100): Promise<string[]> {
    const r = await llamar("POST", "/contacts/search", {
      locationId: env.ghlLocationId(),
      pageLimit: Math.min(limite, 100),
      filters: [{ field: "tags", operator: "contains", value: tag }],
    });
    /**
     * LANZA en vez de devolver `[]` (corregido 2026-08-04).
     *
     * La lista vacía era indistinguible de "el territorio no tiene a nadie", y desde que el
     * barrido congela por ausencia (`sincronizarTerritorio`), un 429 de GHL habría congelado
     * la base entera de un golpe. Un error acá tiene que doler, no simularse.
     */
    if (!r.ok) throw new Error(`buscarPorTag(${tag}): ${r.error ?? `GHL respondió ${r.status}`}`);
    return (r.datos?.contacts ?? []).map((c: any) => c.id).filter(Boolean);
  },

  async verificarConexion() {
    const locationId = env.ghlLocationId();

    const tagsR = await llamar("GET", `/locations/${locationId}/tags`);
    if (!tagsR.ok) return { ok: false, error: tagsR.error, status: tagsR.status };

    const camposR = await llamar("GET", `/locations/${locationId}/customFields`);
    if (!camposR.ok) return { ok: false, error: camposR.error, status: camposR.status };

    return {
      ok: true,
      locationId,
      tags: (tagsR.datos?.tags ?? []).map((t: any) => t.name ?? t).filter(Boolean),
      customFields: (camposR.datos?.customFields ?? [])
        .map((f: any) => f.fieldKey ?? f.key ?? f.name)
        .filter(Boolean),
    };
  },
};
