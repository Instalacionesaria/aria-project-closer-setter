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

import { CAMPOS, CAMPOS_PERFIL, TAGS } from "../../src/lib/ghl/contrato.js";
import { ghl } from "./ghl/index.js";
import { leerCampo, leerEntero } from "./ghl/lectura.js";
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
 * Trae UN contacto de GHL y lo espeja. Lo llama el webhook en cada evento de contacto.
 *
 * **`bot_estado` ya no se escribe** (2026-08-04): la columna estaba NULL en los 7 contactos
 * de producción pese a que esta función decía llenarla, y nadie la leía de vuelta. El estado
 * del bot se deriva de los tags en cada lectura, con `botDesdeTags` de `contrato.ts` — que
 * ahora es la única implementación. Ver migración 013.
 *
 * **Los contadores del agente de voz SÍ se denormalizan** acá, y es la excepción deliberada:
 * su origen son custom fields de GHL, así que traerlos en vivo para pintar una lista costaría
 * una llamada por fila. Como esta función ya tiene el contacto completo en la mano, cachearlos
 * es gratis. Su frescura es la del último sync (webhook de contacto, cron de :25/:55, botón
 * Sincronizar CRM, o abrir la ficha) — no es tiempo real y no se promete como tal.
 */
export async function sincronizarContacto(ghlContactId: string): Promise<boolean> {
  const contacto = await ghl().obtenerContacto(ghlContactId);
  if (!contacto) return false;

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
        /* Congelado = perdió `zona_closer` (§7 del doc de conexiones): sigue visible y movible
           por el pipeline, pero no se gasta NI UNA llamada de GHL más en él. Si el tag
           reaparece en un refresco futuro, esto mismo lo descongela. */
        congelado: !(contacto.tags ?? []).includes(TAGS.zonaCloser.valor),

        // Subcategorías de Avanzar. Se leen todas: la píldora usará la del stage actual,
        // pero las demás quedan disponibles para Gerencia (regla de acumulación, §4).
        // Vía `leerCampo`, que normaliza mayúsculas y prefijo — el lector anterior era
        // case-sensitive y podía estar guardando null en silencio.
        nivel_interes_seguimiento: leerCampo(contacto, CAMPOS.nivelInteresSeguimiento.valor),
        motivo_descalificacion: leerCampo(contacto, CAMPOS.motivoDescalificacion.valor),
        forma_pago_venta: leerCampo(contacto, CAMPOS.formaPagoVenta.valor),
        razon_noshow: leerCampo(contacto, CAMPOS.razonNoshow.valor),
        origen_nurture: leerCampo(contacto, CAMPOS.origenNurture.valor),

        // 📞 — los agregados del agente de voz, para poder pintar el ícono en una lista.
        llamadas_ia_intentos: leerEntero(contacto, CAMPOS_PERFIL.llamadasIaIntentos.valor),
        llamadas_ia_contestadas: leerEntero(contacto, CAMPOS_PERFIL.llamadasIaContestadas.valor),
        ultima_llamada_ia_resultado: leerCampo(contacto, CAMPOS_PERFIL.ultimaLlamadaIaResultado.valor),

        sincronizado_el: new Date().toISOString(),
      },
      { onConflict: "ghl_contact_id" },
    );

  if (error) throw new Error(`sincronizar ${ghlContactId}: ${error.message}`);
  return true;
}

export interface ResultadoSync {
  /** Cuántos contactos tienen `zona_closer` en GHL ahora mismo. */
  encontrados: number;
  /** De esos, cuántos se releyeron y espejaron sin error. */
  sincronizados: number;
  /** Cuántos quedaron marcados como congelados en esta corrida (perdieron el tag). */
  congelados: number;
  /** Cuántos volvieron al territorio (recuperaron el tag y estaban congelados). */
  descongelados: number;
  /** La lista de GHL llegó al tope: la ausencia de un contacto NO prueba nada. */
  truncado: boolean;
  tope: number;
  /** Para que el gasto quede visible y §51.4 sea auto-verificable, no auto-declarada. */
  llamadasGhl: number;
  errores: string[];
}

/**
 * Barre TODO el territorio del closer. Es la red de seguridad del webhook, lo que puebla la
 * app la primera vez, y —desde el 2026-08-04— lo que hace el botón "Sincronizar CRM".
 *
 * `zona_closer` es el portón de entrada, verificado contra el contrato §3 y §9: lo aplica el
 * WF 04.1 al agendar y persiste. No es `cita_agendada`, que se quita al cerrar la cita y
 * borraría al contacto de las vistas justo cuando empieza el trabajo del closer.
 *
 * ## Por qué se barre POR TAG y no por las filas cacheadas
 *
 * Recorrer `closer_contactos` y refrescar cada fila costaría una llamada por congelado, y
 * §51.3 es explícito: por un contacto fuera de zona no se gasta NI UNA. Pedirle la lista a
 * GHL resuelve las dos direcciones con una sola llamada: el que recuperó el tag aparece y se
 * descongela solo; el que lo perdió se detecta por AUSENCIA, gratis.
 *
 * ## El guard que no se puede sacar
 *
 * Congelar por ausencia es peligroso: si la lista llega vacía o recortada, congelaría gente
 * que sí está en zona. Dos condiciones lo evitan, y las dos son necesarias:
 *   · `!truncado` — con la lista al tope, la ausencia no prueba nada.
 *   · `ids.length > 0` — un territorio genuinamente vacío es indistinguible de un fallo.
 * `buscarPorTag` ahora LANZA ante un error de GHL (antes devolvía `[]`), así que el segundo
 * guard es defensa en profundidad, no la única barrera.
 */
export async function sincronizarTerritorio(opciones: { tope?: number } = {}): Promise<ResultadoSync> {
  const tope = Math.min(Math.max(opciones.tope ?? 100, 1), 100);
  const vacio: ResultadoSync = {
    encontrados: 0,
    sincronizados: 0,
    congelados: 0,
    descongelados: 0,
    truncado: false,
    tope,
    llamadasGhl: 0,
    errores: [],
  };

  const cliente = ghl();
  if (cliente.modo !== "real") {
    return { ...vacio, errores: ["Adapter en modo stub: no hay de dónde sincronizar."] };
  }

  const ids = await cliente.buscarPorTag(TAGS.zonaCloser.valor, tope);
  let llamadasGhl = 1;
  const truncado = ids.length >= tope;
  const errores: string[] = [];

  // Quién estaba congelado ANTES, para poder informar cuántos volvieron. Cero llamadas a GHL.
  const { data: previos } = await db()
    .from("closer_contactos")
    .select("ghl_contact_id, congelado")
    .eq("org_id", ORG_ID);
  const congeladoAntes = new Set(
    ((previos ?? []) as { ghl_contact_id: string; congelado: boolean }[])
      .filter((c) => c.congelado)
      .map((c) => c.ghl_contact_id),
  );

  // En serie a propósito: GHL limita la frecuencia de peticiones, y un barrido en paralelo
  // sobre cientos de contactos se comería la cuota.
  let sincronizados = 0;
  for (const id of ids) {
    try {
      llamadasGhl++;
      if (await sincronizarContacto(id)) sincronizados++;
    } catch (e) {
      errores.push(`${id}: ${(e as Error).message}`);
    }
  }

  let congelados = 0;
  if (!truncado && ids.length > 0) {
    const { data, error } = await db()
      .from("closer_contactos")
      .update({ congelado: true })
      .eq("org_id", ORG_ID)
      .eq("congelado", false)
      .not("ghl_contact_id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`)
      .select("ghl_contact_id");
    if (error) errores.push(`congelar por ausencia: ${error.message}`);
    congelados = (data ?? []).length;
  }

  return {
    encontrados: ids.length,
    sincronizados,
    congelados,
    descongelados: ids.filter((id) => congeladoAntes.has(id)).length,
    truncado,
    tope,
    llamadasGhl,
    errores,
  };
}
