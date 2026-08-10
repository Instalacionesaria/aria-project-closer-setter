/**
 * `GET /api/admin/alta` — el checklist de alta de una empresa, **derivado** (plan §4.1).
 *
 * ── Por qué es un endpoint y no un documento ───────────────────────────
 *
 * Porque un checklist en un `.md` empieza correcto y se desactualiza el primer día: alguien carga
 * el PIT y no vuelve a marcar la casilla, o la marca y el PIT nunca se cargó. Cada ítem de acá se
 * calcula del estado real, así que no existe la posibilidad de que diga verde sobre algo que falta.
 *
 * Es la diferencia que este proyecto ya pagó tres veces —los prompts que nunca existieron mientras
 * el panel reportaba éxito, `closer_conexiones` que nadie leía, el alta de empresas que nadie
 * ejercitó (ver D36 y D42)— y siempre por el mismo motivo: **una afirmación que nadie verificó**.
 *
 * ── Los tres estados, y por qué no son dos ────────────────────────────
 *
 *   `listo`     · verificado. No "el campo tiene algo": comprobado.
 *   `falta`     · verificado que no está, y hay que hacer algo.
 *   `sin_dato`  · **no se pudo averiguar.** No es un `falta` prudente ni un `listo` optimista.
 *
 * El tercero existe por la regla 2 de `CLAUDE.md`. Si la llamada de prueba a GHL no se pudo hacer
 * —porque la clave maestra de cifrado no está, por ejemplo— la respuesta lo dice en vez de elegir
 * uno de los otros dos. Un `falta` inventado manda a alguien a cargar una credencial que ya estaba;
 * un `listo` inventado es peor.
 *
 * ── La llamada de prueba, y por qué se paga ───────────────────────────
 *
 * El plan pide *"una llamada de prueba de solo lectura"* para el PIT, y es el único ítem que cuesta
 * una llamada a GHL. Se usa `/calendars/events` porque **valida las tres credenciales de una vez**:
 * el PIT autentica, el `locationId` filtra y el `calendarId` tiene que existir dentro de esa
 * subcuenta. Un 200 prueba las tres; un 401 y un 404 se distinguen entre sí en el mensaje.
 *
 * La ventana es de un día y el resultado —cuántos eventos— **se descarta**: lo que se verifica es
 * que la llamada no falló. Cero eventos en un martes no dice nada sobre las credenciales.
 *
 * Se puede saltear con `?probar=0`, para revisar los otros siete ítems sin gastar la llamada.
 *
 * ── Un ítem que se ve verde y no lo está ──────────────────────────────
 *
 * El de webhooks es el más importante y el más fácil de malinterpretar. Tener URL y secreto
 * generados **no significa que el cliente los haya pegado en GHL**: eso solo se sabe si llegó al
 * menos un evento. Por eso el ítem no se pone en `listo` con el secreto: exige un evento real en
 * `closer_webhook_inbox` con el `org_id` de esta empresa. Es la única evidencia de que el circuito
 * está cerrado del otro lado, donde no tenemos ninguna visibilidad.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigir } from "../_lib/auth.js";
import { activar, conCredenciales, resolverCredenciales, type Credenciales } from "../_lib/credenciales.js";
import { hayClaveMaestra } from "../_lib/cifrado.js";
import { dbSinScope } from "../_lib/db.js";
import { eventosDeCalendario } from "../_lib/ghl/lectura.js";
import { auditorHabilitado } from "../../src/lib/auditores.js";

type Estado = "listo" | "falta" | "sin_dato";

export interface Item {
  clave: string;
  titulo: string;
  estado: Estado;
  /** Qué se comprobó, en una línea. Siempre presente: un estado sin evidencia no se puede auditar. */
  detalle: string;
  /** Qué hacer, solo cuando hay algo que hacer. */
  accion?: string;
  /** `true` = sin esto la empresa no opera. Un faltante no bloqueante no pinta rojo. */
  bloqueante: boolean;
}

/**
 * Las cuatro columnas de prompt, con el agente al que alimentan y su nombre visible.
 *
 * El nombre va acá y no importado: el catálogo con los nombres vive en `agentAuditStore.tsx`, un
 * store de React, y traerlo a una función serverless por cuatro strings arrastraría el store entero
 * —con sus hooks— dentro del bundle de un endpoint.
 */
const PROMPTS = [
  { agente: "appointment-flow-ai", titulo: "Appointment Flow AI (chat)", columna: "prompt_appointment_texto", hash: "prompt_appointment_texto_hash" },
  { agente: "lead-flow-ai", titulo: "Lead Flow AI (chat)", columna: "prompt_lead_texto", hash: "prompt_lead_texto_hash" },
  { agente: "appointment-flow-voz", titulo: "Appointment Flow (voz)", columna: "prompt_appointment_voz", hash: "prompt_appointment_voz_hash" },
  { agente: "lead-flow-voz", titulo: "Lead Flow (voz)", columna: "prompt_lead_voz", hash: "prompt_lead_voz_hash" },
] as const;

/**
 * Solo la identidad de la empresa y los prompts.
 *
 * **Ninguna credencial se selecciona acá**: salen de `resolverCredenciales()`, que aplica los
 * fallbacks y ya tiene su propio motivo para descifrarlas. Traerlas también en esta consulta
 * pondría texto cifrado en un proceso que no lo necesita, y la única regla no negociable de
 * `conexiones.ts` era exactamente ésa: lo que no entra al proceso no se puede escapar por un log.
 *
 * Los prompts sí, porque el checklist reporta su largo y su hash — y no son secretos.
 */
const COLUMNAS = [
  "org_id",
  "nombre",
  "slug",
  "activa",
  "es_principal",
  "zona_horaria",
  ...PROMPTS.flatMap((p) => [p.columna, p.hash]),
].join(", ");

type Fila = Record<string, string | boolean | null>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * `super_admin` y no `admin`: el checklist compara el estado de una empresa contra lo que el alta
   * exige, y quien hace altas es quien nos representa. Un admin de cliente ve su configuración en
   * Ajustes › Credenciales, que es su vista y solo la suya.
   */
  const ctx = await exigir(req, res, ["super_admin"]);
  if (!ctx) return;
  /**
   * Se activa la empresa **propia** del super admin, no la que está mirando. Es la base: cualquier
   * consulta que no lleve un `org_id` explícito cae en la suya y no en la ajena por accidente. La
   * sonda a GHL abre la de la empresa objetivo con `conCredenciales()`, que la cierra al terminar
   * (ver `probarGhl`).
   */
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  const orgId = String(req.query.orgId ?? "").trim() || ctx.orgEfectiva;
  const probar = String(req.query.probar ?? "1") !== "0";

  try {
    /**
     * `dbSinScope()` con el `org_id` explícito en el `.eq`, y es una de las excepciones auditadas:
     * un super admin revisa el alta de una empresa **sin cambiar la suya activa**. Cambiar de
     * empresa para poder mirar un checklist obligaría a saltar entre empresas para comparar cuatro
     * altas, y cada salto es un cambio de contexto real con su registro de auditoría.
     */
    const { data, error } = await dbSinScope().from("closer_org_config").select(COLUMNAS).eq("org_id", orgId).maybeSingle();

    if (error) return res.status(503).json({ ok: false, error: `No se pudo leer la empresa: ${error.message}` });
    if (!data) return res.status(404).json({ ok: false, codigo: "empresa_desconocida", error: "Esa empresa no existe." });

    const fila = data as unknown as Fila;
    const items: Item[] = [];
    let llamadasGhl = 0;

    /**
     * ── Las credenciales se leen RESUELTAS, no de la columna ────────────
     *
     * Y la diferencia decide si este checklist sirve. `resolverCredenciales()` aplica la tabla de
     * §5.2: toma la de la empresa y, **solo para la principal**, cae a la variable global — que es
     * de donde salen hoy el PIT y el Location ID de ARIA, porque nunca se cargaron en la base.
     *
     * Mirar la columna diría "falta el PIT" sobre la única empresa que sin duda opera. Un checklist
     * que se equivoca en el caso que todos conocen es un checklist que nadie vuelve a mirar. Es el
     * mismo error que `admin/webhooks.ts` casi cometió con el secreto: ahí también hay que mostrar
     * el **efectivo**, no la columna.
     *
     * `desdeEntorno` es la lista de las que se resolvieron así, y se dice: una empresa apoyada en
     * una variable global no es lo mismo que una con lo suyo cargado, aunque las dos funcionen.
     */
    const cred = await resolverCredenciales(orgId);
    const global = new Set(cred.desdeEntorno);
    const origen = (variable: string) => (global.has(variable) ? " (de la variable global, no de esta empresa)" : "");

    /* ── 1. Las tres credenciales de GHL, con la llamada de prueba ───── */
    const tieneGhl = Boolean(cred.ghlPit) && Boolean(cred.ghlLocationId);
    const tieneCalendario = Boolean(cred.ghlCalendarioId);

    if (!tieneGhl) {
      items.push({
        clave: "ghl_credenciales",
        titulo: "PIT y Location ID de GHL",
        /**
         * Sin clave maestra el PIT no se puede descifrar, y entonces `cred.ghlPit` viene `null` sea
         * porque no hay ninguno o porque no se pudo abrir. **No se distingue, y no hace falta**: la
         * respuesta honesta en los dos casos es la misma —no se sabe— y evita traer el texto
         * cifrado al proceso solo para decidir cuál de los dos mensajes mostrar. Un secreto que no
         * se necesita no se lee (mismo criterio que las columnas `*_ultimos4`).
         */
        estado: hayClaveMaestra() ? "falta" : "sin_dato",
        detalle: hayClaveMaestra()
          ? [!cred.ghlPit && "no hay PIT", !cred.ghlLocationId && "no hay Location ID"].filter(Boolean).join(" · ")
          : "Falta `CIFRADO_CLAVE` en el entorno: si hay un PIT guardado no se puede descifrar, así que no se sabe si sirve.",
        accion: hayClaveMaestra()
          ? "Ajustes › Credenciales. Sin esto la empresa no lee ni escribe nada en GHL."
          : "Cargar `CIFRADO_CLAVE` en Vercel y redesplegar: las variables se congelan al deploy.",
        bloqueante: true,
      });
    } else if (!probar) {
      items.push({
        clave: "ghl_credenciales",
        titulo: "PIT y Location ID de GHL",
        estado: "sin_dato",
        detalle: "Las dos están cargadas, pero no se probaron: se pidió el checklist con `probar=0`.",
        accion: "Volver a pedirlo sin `probar=0` para confirmar que GHL las acepta.",
        bloqueante: true,
      });
    } else {
      const sonda = await probarGhl(cred, cred.ghlCalendarioId);
      llamadasGhl += sonda.llamadas;
      items.push({
        clave: "ghl_credenciales",
        titulo: "PIT y Location ID de GHL",
        estado: sonda.ok ? "listo" : "falta",
        detalle: sonda.detalle + origen("GHL_PIT"),
        ...(sonda.ok ? {} : { accion: "Revisar el PIT y el Location ID en Ajustes › Credenciales." }),
        bloqueante: true,
      });
    }

    /**
     * El calendario va como ítem aparte aunque la sonda lo valide junto con el resto, porque
     * **falta por separado**: una empresa puede tener PIT y Location ID perfectos y no haber
     * cargado el calendario, y en ese caso lo único que no funciona es la sincronización de
     * agenda. Mezclarlos haría que un checklist en rojo no diga qué cargar.
     */
    items.push({
      clave: "ghl_calendario",
      titulo: "Calendario de GHL",
      estado: tieneCalendario ? "listo" : "falta",
      detalle: tieneCalendario
        ? `Cargado: ${String(cred.ghlCalendarioId).slice(0, 8)}…${origen("GHL_DEFAULT_CALENDAR_ID")}`
        : "Sin calendario: el cron no puede leer citas, así que la Agenda queda vacía.",
      ...(tieneCalendario ? {} : { accion: "Ajustes › Credenciales › Calendario de GHL." }),
      bloqueante: true,
    });

    /* ── 2. La key de Anthropic ─────────────────────────────────────── */
    /**
     * Que falte **no es bloqueante**: `credenciales.ts` cae a la key global mientras exista. Pero
     * el criterio de aceptación §4.4 del plan dice que ningún cliente puede quedarse en la global
     * *"sin que eso sea una decisión explícita registrada"*, así que el ítem lo dice en vez de
     * pintarse verde: la empresa audita con nuestra key y el consumo lo pagamos nosotros.
     */
    const tieneKey = Boolean(cred.anthropicKey) && !global.has("ANTHROPIC_API_KEY");
    items.push({
      clave: "anthropic",
      titulo: "API key de Anthropic",
      estado: tieneKey ? "listo" : "falta",
      detalle: tieneKey
        ? "Propia, cargada y cifrada."
        : "Sin key propia: audita con la global, y ese consumo lo pagamos nosotros.",
      ...(tieneKey ? {} : { accion: "Cargar la del cliente, o registrar por escrito que usa la global a propósito." }),
      bloqueante: false,
    });

    /* ── 3. Meta ────────────────────────────────────────────────────── */
    const tieneMeta = Boolean(cred.metaToken) && Boolean(cred.metaAdAccountId);
    items.push({
      clave: "meta",
      titulo: "Meta (Adquisición)",
      estado: tieneMeta ? "listo" : "falta",
      detalle: tieneMeta
        ? `Cuenta ${String(cred.metaAdAccountId)} con token cargado.`
        : "Sin conectar: el módulo Adquisición no tiene de dónde leer el gasto.",
      ...(tieneMeta
        ? {}
        : { accion: "Ajustes › Credenciales › Meta. Hacen falta las DOS: cuenta publicitaria y token." }),
      /** No bloquea operar: un closer trabaja sin Adquisición. Bloquea el módulo, no la empresa. */
      bloqueante: false,
    });

    /* ── 4. Los prompts de los agentes ──────────────────────────────── */
    /**
     * Los cuatro se reportan siempre, y cada uno dice si su agente está **habilitado**. Un prompt
     * de voz faltante no es lo mismo que uno de texto: los auditores de voz están bloqueados por
     * `AUDITOR_VOZ_HABILITADO`, así que cargarlo hoy no cambiaría nada. Marcarlo como pendiente
     * mandaría a pedirle al cliente un texto que nadie va a usar.
     */
    for (const p of PROMPTS) {
      const contenido = fila[p.columna] as string | null;
      const hash = fila[p.hash] as string | null;
      const habilitado = auditorHabilitado(p.agente);
      const cargado = Boolean(contenido?.trim());
      items.push({
        clave: `prompt_${p.agente}`,
        titulo: `Prompt · ${p.titulo}`,
        estado: cargado ? "listo" : habilitado ? "falta" : "sin_dato",
        detalle: cargado
          ? `${contenido!.trim().length} caracteres · hash ${(hash ?? "?").slice(0, 8)}`
          : habilitado
            ? "Vacío. El auditor de este agente está encendido y compara contra su propio prompt."
            : "Vacío, y su auditor está bloqueado: cargarlo hoy no cambiaría nada.",
        ...(cargado || !habilitado ? {} : { accion: "Ajustes › Agentes. Lo pega el rol técnico." }),
        /** Solo bloquea el que alimenta a un auditor encendido. */
        bloqueante: habilitado && !cargado,
      });
    }

    /* ── 5. Los dos webhooks ────────────────────────────────────────── */
    /**
     * Dos queries y no un `group by`: PostgREST no expone agregaciones, y son dos `head: true` con
     * `limit(1)` — o sea, el planner corta en la primera fila. Más barato que traer nada.
     */
    const [ghlEventos, llamadaEventos] = await Promise.all([
      contarEventos(orgId, "ghl"),
      contarEventos(orgId, "assistable"),
    ]);

    items.push(
      itemWebhook({
        clave: "webhook_ghl",
        titulo: "Webhook de GoHighLevel",
        secreto: Boolean(cred.ghlWebhookSecret),
        eventos: ghlEventos,
        donde: "el workflow de GHL, header `x-webhook-secret`",
      }),
      itemWebhook({
        clave: "webhook_llamadas",
        titulo: "Webhook de llamadas (Assistable)",
        secreto: Boolean(cred.assistableToken),
        eventos: llamadaEventos,
        donde: "Assistable, el campo de URL (el token va adentro)",
        /** Sin agentes de voz una empresa opera igual. La ingesta de chat, no. */
        bloqueante: false,
      }),
    );

    /* ── 6. Usuarios ────────────────────────────────────────────────── */
    const { data: usuarios, error: errU } = await dbSinScope()
      .from("closer_usuarios")
      .select("nombre, roles, activo, es_admin_principal, ultimo_acceso_el, debe_cambiar_password")
      .eq("org_id", orgId);

    if (errU) {
      items.push({
        clave: "usuarios",
        titulo: "Usuarios",
        estado: "sin_dato",
        detalle: `No se pudieron leer: ${errU.message}`,
        bloqueante: true,
      });
    } else {
      items.push(itemUsuarios((usuarios ?? []) as FilaUsuario[]));
    }

    /* ── El veredicto del checklist ─────────────────────────────────── */
    /**
     * `listo` global solo si **ningún** ítem bloqueante quedó fuera de `listo`. Un `sin_dato`
     * bloqueante no cuenta como aprobado: no saber es distinto de estar bien, y ésta es justo la
     * pantalla donde esa diferencia decide si se lanza una empresa o no.
     */
    const bloqueantesPendientes = items.filter((i) => i.bloqueante && i.estado !== "listo");

    return res.status(200).json({
      ok: true,
      empresa: {
        orgId,
        nombre: fila.nombre,
        slug: fila.slug,
        activa: fila.activa,
        esPrincipal: fila.es_principal,
        zonaHoraria: fila.zona_horaria,
      },
      // Se dice cuántas llamadas costó: es la única pantalla del panel que gasta cuota de GHL.
      llamadasGhl,
      probada: probar,
      lista: bloqueantesPendientes.length === 0,
      faltantesBloqueantes: bloqueantesPendientes.map((i) => i.clave),
      items,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/* ================================================================== */
/* Las piezas                                                          */
/* ================================================================== */

/**
 * La llamada de prueba. Devuelve qué pasó, nunca lanza.
 *
 * Va dentro de `conCredenciales()` y no de `activar()`: el super admin está mirando OTRA empresa,
 * así que las credenciales tienen que valer **solo durante esta llamada** y devolverle su contexto
 * después. `activar()` usa `enterWith` y le dejaría la empresa ajena activa para el resto del
 * request — que es exactamente el agujero que `db()` existe para cerrar.
 */
async function probarGhl(
  cred: Credenciales,
  calendarioId: string | null,
): Promise<{ ok: boolean; detalle: string; llamadas: number }> {
  try {
    if (!calendarioId) {
      /**
       * Sin calendario no hay nada que pedirle a `/calendars/events`. **No se inventa otra sonda**:
       * el ítem del calendario ya reporta que falta, y afirmar acá que el PIT está bien sin haberlo
       * probado sería un `listo` sin evidencia. Queda `sin_dato`, que es la verdad.
       */
      return { ok: false, detalle: "No se pudo probar: la sonda usa el calendario, y no hay uno cargado.", llamadas: 0 };
    }
    const desde = Date.now();
    await conCredenciales(cred, () =>
      eventosDeCalendario({ calendarId: calendarioId, desdeMs: desde, hastaMs: desde + 86_400_000 }),
    );
    // El número de eventos se descarta a propósito: lo que prueba las credenciales es el 200.
    return { ok: true, detalle: "GHL respondió 200 a una lectura de calendario: PIT, Location ID y calendario válidos.", llamadas: 1 };
  } catch (e) {
    return { ok: false, detalle: `GHL rechazó la lectura de prueba — ${(e as Error).message.slice(0, 200)}`, llamadas: 1 };
  }
}

/** Cuántos eventos de este proveedor llegaron para esta empresa. `null` si no se pudo saber. */
async function contarEventos(orgId: string, proveedor: string): Promise<number | null> {
  const { count, error } = await dbSinScope()
    .from("closer_webhook_inbox")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("proveedor", proveedor);
  // `null` y no `0`: "no pude contar" no es "no llegó ninguno" (regla 2).
  return error ? null : (count ?? 0);
}

export function itemWebhook(a: {
  clave: string;
  titulo: string;
  secreto: boolean;
  eventos: number | null;
  donde: string;
  bloqueante?: boolean;
}): Item {
  const bloqueante = a.bloqueante ?? true;

  if (a.eventos === null) {
    return {
      clave: a.clave,
      titulo: a.titulo,
      estado: "sin_dato",
      detalle: "No se pudo contar los eventos recibidos, así que no se sabe si el circuito está cerrado.",
      bloqueante,
    };
  }
  if (a.eventos > 0) {
    return {
      clave: a.clave,
      titulo: a.titulo,
      estado: "listo",
      detalle: `${a.eventos} evento${a.eventos === 1 ? "" : "s"} recibido${a.eventos === 1 ? "" : "s"}: el cliente ya lo pegó y funciona.`,
      bloqueante,
    };
  }
  /**
   * Secreto sí, eventos no. Es el estado que más se malinterpreta: **el panel puede mostrar la URL
   * y el secreto sin que nadie los haya pegado del otro lado.** Un evento recibido es la única
   * prueba, así que sin eso no se pone en verde.
   */
  return {
    clave: a.clave,
    titulo: a.titulo,
    estado: "falta",
    detalle: a.secreto
      ? "URL y secreto generados, pero **nunca llegó un evento**: no hay forma de saber si el cliente los pegó."
      : "Sin secreto todavía: se genera al abrir Ajustes › Webhooks.",
    accion: `Copiar la URL de Ajustes › Webhooks y pegarla en ${a.donde}. Después, disparar un evento de prueba.`,
    bloqueante,
  };
}

export interface FilaUsuario {
  nombre: string;
  roles: string[] | null;
  activo: boolean;
  es_admin_principal: boolean;
  ultimo_acceso_el: string | null;
  debe_cambiar_password: boolean;
}

/**
 * El ítem de usuarios: cuántos hay, con qué roles, y **si el admin ya entró**.
 *
 * Lo último es el que importa. Crear el admin y mandarle la contraseña temporal no es lo mismo que
 * el admin habiendo entrado: `ultimo_acceso_el` en `null` significa que el mail se perdió, la
 * contraseña no llegó, o nadie lo intentó — y eso se descubre el día del lanzamiento si esta
 * pantalla no lo dice.
 */
export function itemUsuarios(us: FilaUsuario[]): Item {
  const activos = us.filter((u) => u.activo);
  const admins = activos.filter((u) => (u.roles ?? []).includes("admin"));
  const principal = activos.find((u) => u.es_admin_principal);
  const operativos = activos.filter((u) => (u.roles ?? []).some((r) => r === "closer" || r === "setter"));

  if (admins.length === 0) {
    return {
      clave: "usuarios",
      titulo: "Usuarios",
      estado: "falta",
      detalle: `${activos.length} activo${activos.length === 1 ? "" : "s"}, y ninguno con rol admin: nadie puede configurar esta empresa.`,
      accion: "Administración › Usuarios: crear el admin del cliente con contraseña temporal.",
      bloqueante: true,
    };
  }

  const entro = principal ? principal.ultimo_acceso_el !== null : admins.some((u) => u.ultimo_acceso_el !== null);
  const conteo =
    `${activos.length} activo${activos.length === 1 ? "" : "s"} · ${admins.length} admin` +
    `${admins.length === 1 ? "" : "s"} · ${operativos.length} operativo${operativos.length === 1 ? "" : "s"}`;

  if (!entro) {
    return {
      clave: "usuarios",
      titulo: "Usuarios",
      estado: "falta",
      detalle: `${conteo}. El admin **todavía no entró nunca**: la contraseña temporal sigue sin usar.`,
      accion: "Confirmar con el cliente que recibió su acceso y que pudo entrar.",
      bloqueante: true,
    };
  }

  const pendientes = admins.filter((u) => u.debe_cambiar_password).length;
  return {
    clave: "usuarios",
    titulo: "Usuarios",
    estado: "listo",
    detalle:
      `${conteo}. El admin ya entró` +
      (pendientes > 0 ? `, pero ${pendientes} sigue con la contraseña temporal sin cambiar.` : " y cambió su contraseña."),
    ...(pendientes > 0 ? { accion: "Pedirle que la cambie: la temporal circuló por un canal que no controlamos." } : {}),
    bloqueante: false,
  };
}
