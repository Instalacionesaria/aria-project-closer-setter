/**
 * Sincronización GHL → proyección de contactos.
 *
 * El webhook da inmediatez; esto da la garantía. Los webhooks se pierden —workflow
 * desactivado, deploy a mitad de camino, error de red— y un contacto que se pierde no vuelve
 * solo. `sincronizarTerritorio()` barre todos los contactos con `zona_closer` y rellena lo
 * que falte, así que el peor caso de un webhook caído es "el contacto aparece tarde", no
 * "el contacto no aparece nunca".
 *
 * GHL siempre gana: esta tabla se sobrescribe entera en cada sync. Nada propio del tool vive
 * acá — el pin, el completado del día y la fecha del seguimiento manual están en sus tablas
 * aparte justamente para que un sync no los borre.
 */

import { TAGS, TAGS_BOT } from "../../src/lib/ghl/contrato.js";
import { ghl } from "./ghl/index.js";
import { ORG_ID, db } from "./repo.js";

/** El chip de fuente que va en la fila (§8). Sin origen reconocible → DIRECTO, nunca vacío. */
function fuenteDesdeTags(tags: readonly string[]): string {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes("instagram") || x === "ig")) return "📷 IG PROFILE";
  if (t.includes("lead_meta_ads")) return "META ADS";
  if (t.some((x) => x.includes("vsl"))) return "VSL OPT-IN";
  return "DIRECTO";
}

/**
 * El estado del bot sale de los tags, que son los interruptores reales (§9 del contrato).
 * `undefined` = sin tag de bot; la UI lo trata como "activo" por defecto, salvo IG que no
 * tiene bot en absoluto (§11).
 */
function botDesdeTags(tags: readonly string[]): string | null {
  if (tags.includes(TAGS_BOT.botPausadoFallo.valor)) return "pausado_fallo";
  if (tags.includes("bot_apagado_manual")) return "apagado_manual";
  if (tags.includes(TAGS_BOT.botDesactivadoPostcall.valor)) return "muerto_postcall";
  if (tags.includes("derivado_lt")) return "derivado_lt";
  return null;
}

/** Trae UN contacto de GHL y lo espeja. Lo llama el webhook en cada evento de contacto. */
export async function sincronizarContacto(ghlContactId: string): Promise<boolean> {
  const contacto = await ghl().obtenerContacto(ghlContactId);
  if (!contacto) return false;

  const cf = contacto.customFields ?? {};
  const leer = (clave: string) => cf[clave] ?? cf[clave.replace(/^contact\./, "")] ?? null;

  const { error } = await db()
    .from("closer_contactos")
    .upsert(
      {
        ghl_contact_id: contacto.id,
        org_id: ORG_ID,
        nombre: contacto.nombre || contacto.id,
        telefono: contacto.telefono ?? null,
        email: contacto.email ?? null,
        tags: contacto.tags ?? [],
        fuente: fuenteDesdeTags(contacto.tags ?? []),
        bot_estado: botDesdeTags(contacto.tags ?? []),

        // Subcategorías de Avanzar. Se leen todas: la píldora usará la del stage actual,
        // pero las demás quedan disponibles para Gerencia (regla de acumulación, §4).
        nivel_interes_seguimiento: leer("contact.nivel_de_inters_seguimiento"),
        motivo_descalificacion: leer("contact.motivo_de_descalificacin"),
        forma_pago_venta: leer("contact.forma_de_pago_venta"),
        razon_noshow: leer("contact.razn_de_noshow"),
        origen_nurture: leer("contact.origen_nurture"),

        sincronizado_el: new Date().toISOString(),
      },
      { onConflict: "ghl_contact_id" },
    );

  if (error) throw new Error(`sincronizar ${ghlContactId}: ${error.message}`);
  return true;
}

export interface ResultadoSync {
  encontrados: number;
  sincronizados: number;
  errores: string[];
}

/**
 * Barre TODO el territorio del closer. Es la red de seguridad del webhook, y también lo que
 * puebla la app la primera vez (antes de que exista ningún evento).
 *
 * `zona_closer` es el portón de entrada, verificado contra el contrato §3 y §9: lo aplica el
 * WF 04.1 al agendar y persiste. No es `cita_agendada`, que se quita al cerrar la cita y
 * borraría al contacto de las vistas justo cuando empieza el trabajo del closer.
 */
export async function sincronizarTerritorio(limite = 100): Promise<ResultadoSync> {
  const cliente = ghl();
  if (cliente.modo !== "real") {
    return { encontrados: 0, sincronizados: 0, errores: ["Adapter en modo stub: no hay de dónde sincronizar."] };
  }

  const ids = await cliente.buscarPorTag(TAGS.zonaCloser.valor, limite);
  const errores: string[] = [];
  let sincronizados = 0;

  // En serie a propósito: GHL limita la frecuencia de peticiones, y un barrido en paralelo
  // sobre cientos de contactos se comería la cuota. Esto corre en segundo plano, no en el
  // camino de una pantalla — que tarde no molesta a nadie.
  for (const id of ids) {
    try {
      if (await sincronizarContacto(id)) sincronizados++;
    } catch (e) {
      errores.push(`${id}: ${(e as Error).message}`);
    }
  }

  return { encontrados: ids.length, sincronizados, errores };
}
