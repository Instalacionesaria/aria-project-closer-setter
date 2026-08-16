/**
 * Prueba de integración contra SOFIA y GHL de verdad.
 *
 * NO corre por defecto: necesita `INTEGRACION=1` y las credenciales en `.env.local`. Sin
 * eso se salta entera, así que `npm test` sigue siendo puro y offline.
 *
 *     $env:INTEGRACION=1; npx vitest run api/_lib/integracion.test.ts
 *
 * ⚠️ Los efectos en GHL se ejercitan SOLO en modo stub. Aplicar `seguimiento_recupero` a un
 * contacto real dispara el workflow de la serie, que le envía tres mensajes a una persona
 * durante siete días — eso no se deshace quitando el tag. La lectura de GHL sí se prueba
 * contra la cuenta real, porque no tiene efectos.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Carga `.env.local` sin sumar una dependencia por tres líneas. */
function cargarEnv() {
  try {
    const texto = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const linea of texto.split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* sin .env.local: los tests se saltan por la guarda de abajo */
  }
}
cargarEnv();

const activa =
  process.env.INTEGRACION === "1" && Boolean(process.env.SUPABASE_URL);
const describeSi = activa ? describe : describe.skip;

/** La empresa del contacto de prueba. Duplica `ORG_PRINCIPAL` para no importar dentro de un `it`. */
const ORG_PRINCIPAL_ID = "00000000-0000-0000-0000-000000000001";

/** Contacto de prueba, inexistente en GHL a propósito: nada que se le pueda enviar. */
const CONTACTO = "integracion_test_no_existe_en_ghl";

/**
 * El closer con el que firma esta suite: Jorge Q., de la empresa principal.
 *
 * `registrarSeguimiento` dejo de aceptar `closerId` opcional (2026-08-08) justamente porque este
 * uuid estaba escrito **dentro** de la libreria como default, firmando lo que registraba cualquier
 * empresa. Aca es el valor correcto —la suite corre contra ARIA— y por eso vive aca, a la vista,
 * en vez de aparecer por omision.
 */
const CLOSER_ARIA = "00000000-0000-0000-0000-0000000000c1";

describeSi("integración — Supabase real, GHL en stub", () => {
  let db: typeof import("./repo").db;
  let registrarSeguimiento: typeof import("./seguimientos").registrarSeguimiento;
  let credenciales: Awaited<
    ReturnType<typeof import("./credenciales").resolverCredenciales>
  >;

  let activar: typeof import("./credenciales").activar;

  beforeAll(async () => {
    // El modo se fija ANTES de importar: el selector del adapter lo lee al construirse.
    process.env.GHL_MODO = "stub";
    ({ db } = await import("./repo"));
    ({ registrarSeguimiento } = await import("./seguimientos"));

    /**
     * Desde el 2026-08-07 `db()` saca la organización del contexto y lanza si no hay ninguna.
     * Este test corre fuera de todo handler, así que la abre él mismo — contra la empresa
     * principal, que es donde vive el contacto de prueba.
     *
     * ── `conCredenciales` y NO `activar` (2026-08-08) ─────────────────
     *
     * Acá decía `activar(await resolverCredenciales(ORG_PRINCIPAL))`, y **los seis tests fallaban
     * con "db() sin empresa activa"**. Es la trampa que `credenciales.ts` documenta: `activar()`
     * usa `enterWith`, que fija el contexto de la cadena de ejecución ACTUAL — llamado dentro de
     * una función `async`, el contexto muere con la continuación de esa función y no llega a
     * quien la esperaba. Un `beforeAll` es exactamente ese caso.
     *
     * `conCredenciales` usa `run`, que abre el contexto alrededor de una función y lo cierra al
     * salir. Por eso cada test se envuelve con `enEmpresa()` en vez de heredar del hook.
     *
     * **Esto llevaba roto desde la migración multi-empresa y nadie lo vio**, porque el script
     * para correr esta suite no existía. Es literalmente el patrón de D36: lo que se construye y
     * no se ejercita, no está construido.
     */
    const cred = await import("./credenciales");
    const { ORG_PRINCIPAL } = await import("./repo");
    activar = cred.activar;
    credenciales = await cred.resolverCredenciales(ORG_PRINCIPAL);
  });

  afterAll(async () => {
    if (!db || !credenciales) return;
    activar(credenciales);
    // Orden obligado: los eventos referencian el seguimiento con `no action`, así que hay
    // que sacarlos primero o el borrado del seguimiento falla — en silencio, porque
    // supabase-js no lanza. Por eso se verifica el resultado en vez de confiar.
    for (const tabla of [
      "closer_ghl_outbox",
      "closer_contacto_eventos",
      "closer_seguimientos",
      "closer_contacto_tarea",
      "closer_notas",
    ]) {
      const { error } = await db()
        .from(tabla)
        .delete()
        .eq("ghl_contact_id", CONTACTO);
      if (error) throw new Error(`limpieza de ${tabla}: ${error.message}`);
    }
    const { count } = await db()
      .from("closer_seguimientos")
      .select("*", { count: "exact", head: true })
      .eq("ghl_contact_id", CONTACTO);
    if (count)
      throw new Error(
        `la limpieza dejó ${count} seguimiento(s) de prueba en SOFIA`,
      );
  });

  it("registra un seguimiento manual y lo deja fuera de la cola de hoy", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const r = await registrarSeguimiento({
      ghlContactId: CONTACTO,
      closerId: CLOSER_ARIA,
      situacion: "dudando",
      modo: "manual",
      preset: "en_3_dias",
      nota: "Nota de la prueba de integración.",
      idempotencyKey: `test-manual-${Date.now()}`,
    });

    expect(r.seguimientoId).toBeTruthy();
    expect(r.toast).toMatch(/Seguimiento programado/);

    const { data } = await db()
      .from("closer_seguimientos_de_hoy")
      .select("*")
      .eq("ghl_contact_id", CONTACTO);
    expect(data ?? []).toHaveLength(0); // vence en 3 días, hoy no toca
  });

  it("la tarea del día queda completada — va a Completadas Hoy", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const { data } = await db()
      .from("closer_contacto_tarea")
      .select("completada_dia")
      .eq("ghl_contact_id", CONTACTO)
      .single();
    const { data: hoy } = await db().rpc("closer_hoy_org", {
      p_org_id: ORG_PRINCIPAL_ID,
    });
    expect(data?.completada_dia).toBe(hoy);
  });

  it("la nota se persiste, para poder leerla el día del seguimiento", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const { data } = await db()
      .from("closer_seguimientos")
      .select("nota")
      .eq("ghl_contact_id", CONTACTO)
      .eq("estado", "pendiente")
      .single();
    expect(data?.nota).toBe("Nota de la prueba de integración.");
  });

  /**
   * EL test del bug del 2026-08-15: la nota de un Seguimiento no aparecía en el tab Notas.
   *
   * El de arriba pasaba —`closer_seguimientos.nota` se llenaba— y aun así la nota estaba
   * perdida para quien abría la ficha: esa columna la lee el motor de recordatorios, no el tab.
   * La ficha consulta `closer_notas`, y ahí no había fila. Dos tablas distintas, dos lectores
   * distintos, y un test verde que solo cubría una.
   *
   * Vale para los DOS roles: el setter llama a `registrarSeguimiento()` entero.
   */
  it("y la MISMA nota aparece en el tab Notas, con la píldora como contexto", async () => {
    activar(credenciales);
    const { data } = await db()
      .from("closer_notas")
      .select("texto, contexto, autor_nombre")
      .eq("ghl_contact_id", CONTACTO);

    const notas = data ?? [];
    expect(notas).toHaveLength(1);
    expect(notas[0].texto).toBe("Nota de la prueba de integración.");
    // El mismo formato que las otras cinco salidas ("SEGUIMIENTO · DUDANDO"), no uno propio.
    expect(notas[0].contexto).toBe("SEGUIMIENTO · DUDANDO");
  });

  it("el stub registra la intención de los tres efectos, sin aplicarlos", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const { data } = await db()
      .from("closer_ghl_outbox")
      .select("operacion, args, estado")
      .eq("ghl_contact_id", CONTACTO);
    const ops = (data ?? []).map((o) => o.operacion).sort();

    expect(ops).toEqual(["aplicar_tag", "escribir_campo", "remover_tag"]);
    expect((data ?? []).every((o) => o.estado === "omitido_stub")).toBe(true);

    const aplicar = (data ?? []).find((o) => o.operacion === "aplicar_tag");
    /**
     * Los TRES tags, no dos.
     *
     * La aserción esperaba `["seguimiento", "seguimiento_manual"]` y llevaba tiempo desactualizada:
     * falta `bot_desactivado_postcall`, que `aplicarEfectosGhl` agrega en **toda** salida menos
     * No-show (doc §8.6 — cualquier resultado del closer prueba que ya hubo llamada de venta).
     *
     * No se descubrió antes porque el script para correr esta suite no existía. Es el mismo patrón
     * que D36: lo que se construye y no se ejercita, no está construido — acá aplicado a un test.
     */
    expect(aplicar?.args?.tags).toEqual([
      "seguimiento",
      "seguimiento_manual",
      "bot_desactivado_postcall",
    ]);

    // El campo lleva el LABEL exacto del dropdown de GHL, no el slug interno.
    const campo = (data ?? []).find((o) => o.operacion === "escribir_campo");
    expect(campo?.args?.campo).toBe("contact.nivel_de_inters_seguimiento");
    expect(campo?.args?.valor).toBe("Dudando");
  });

  it("un segundo seguimiento reemplaza al primero, dejando uno solo abierto", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    await registrarSeguimiento({
      ghlContactId: CONTACTO,
      closerId: CLOSER_ARIA,
      situacion: "muy_interesado",
      modo: "automatico",
      idempotencyKey: `test-auto-${Date.now()}`,
    });

    const { data } = await db()
      .from("closer_seguimientos")
      .select("estado, modo, serie_key")
      .eq("ghl_contact_id", CONTACTO);
    const abiertos = (data ?? []).filter(
      (s) => s.estado === "pendiente" || s.estado === "agotado",
    );

    expect(abiertos).toHaveLength(1);
    expect(abiertos[0].modo).toBe("automatico");
    expect(abiertos[0].serie_key).toBe("recupero");
    expect((data ?? []).some((s) => s.estado === "reemplazado")).toBe(true);
  });

  it("la serie automática NO genera fila en la cola, aunque esté pendiente", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const { data } = await db()
      .from("closer_seguimientos_de_hoy")
      .select("*")
      .eq("ghl_contact_id", CONTACTO);
    expect(data ?? []).toHaveLength(0);
  });
});

/**
 * Escritura REAL en GHL, sobre un contacto de prueba que crea y borra el propio test.
 *
 * Doble compuerta — `INTEGRACION=1` **y** `INTEGRACION_ESCRITURA=1` — porque esto modifica
 * la cuenta de producción.
 *
 * Solo prueba el modo **manual**. Confirmado con Fabio: `seguimiento_manual` no tiene
 * ningún workflow enganchado, así que aplicarlo no envía nada. El modo automático queda
 * deliberadamente fuera: `seguimiento_recupero` dispara la serie Recupero, que manda tres
 * mensajes durante siete días, y eso no se deshace quitando el tag.
 *
 * El contacto se crea sin teléfono y con un email en `example.com`, que es el dominio
 * reservado para pruebas: aunque algo intentara enviarle, no llega a ninguna parte.
 */
const describeEscritura =
  activa && process.env.INTEGRACION_ESCRITURA === "1"
    ? describe
    : describe.skip;

describeEscritura("integración — ESCRITURA real en GHL", () => {
  let contactoId = "";
  let ghlReal: typeof import("./ghl/real").ghlReal;
  let db: typeof import("./repo").db;
  let registrarSeguimiento: typeof import("./seguimientos").registrarSeguimiento;
  let activar: typeof import("./credenciales").activar;
  let credenciales: Awaited<
    ReturnType<typeof import("./credenciales").resolverCredenciales>
  >;

  const BASE = "https://services.leadconnectorhq.com";
  const cab = () => ({
    Authorization: `Bearer ${process.env.GHL_PIT ?? process.env.GHL_API_KEY}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  });

  beforeAll(async () => {
    process.env.GHL_MODO = "real";
    const cred = await import("./credenciales");
    const { ORG_PRINCIPAL } = await import("./repo");
    activar = cred.activar;
    credenciales = await cred.resolverCredenciales(ORG_PRINCIPAL);
    ({ ghlReal } = await import("./ghl/real"));
    ({ db } = await import("./repo"));
    ({ registrarSeguimiento } = await import("./seguimientos"));

    const r = await fetch(`${BASE}/contacts/`, {
      method: "POST",
      headers: cab(),
      body: JSON.stringify({
        locationId: process.env.GHL_LOCATION_ID,
        firstName: "ZZ Prueba",
        lastName: "Comando Central",
        email: `prueba.comando.central.${Date.now()}@example.com`,
        tags: ["zona_closer"],
      }),
    });
    const j = await r.json();
    contactoId = j?.contact?.id ?? "";
    if (!contactoId)
      throw new Error(
        `No se pudo crear el contacto de prueba: ${JSON.stringify(j).slice(0, 300)}`,
      );
  }, 30_000);

  afterAll(async () => {
    /**
     * `activar()` acá por el mismo motivo que en cada `it`: usa `enterWith`, que muere con la
     * continuación async del hook que lo llamó. Sin esta línea el hook tira "db() sin empresa
     * activa" y **la limpieza no corre** — que en esta suite significa filas de prueba vivas en la
     * base de producción y un contacto `@example.com` sin borrar en GHL. El `it` que falla se ve;
     * un `afterAll` que falla deja basura.
     */
    activar(credenciales);
    for (const t of [
      "closer_ghl_outbox",
      "closer_contacto_eventos",
      "closer_seguimientos",
      "closer_contacto_tarea",
    ]) {
      await db().from(t).delete().eq("ghl_contact_id", contactoId);
    }
    if (contactoId)
      await fetch(`${BASE}/contacts/${contactoId}`, {
        method: "DELETE",
        headers: cab(),
      });
  }, 30_000);

  it("el contacto de prueba nace con zona_closer y sin seguimiento", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const c = await ghlReal.obtenerContacto(contactoId);
    expect(c?.tags).toContain("zona_closer");
    expect(c?.tags ?? []).not.toContain("seguimiento_manual");
  });

  it("registrar un seguimiento manual aplica los tags EN GHL de verdad", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const r = await registrarSeguimiento({
      ghlContactId: contactoId,
      closerId: CLOSER_ARIA,
      situacion: "dudando",
      modo: "manual",
      preset: "en_3_dias",
      nota: "Prueba de escritura real.",
      idempotencyKey: `escritura-${Date.now()}`,
    });

    // `aplicado: true` significa que GHL confirmó, no que lo intentamos.
    expect(r.efectosGhl.filter((e) => !e.ok)).toEqual([]);
    expect(r.efectosGhl.every((e) => e.aplicado)).toBe(true);

    const c = await ghlReal.obtenerContacto(contactoId);
    expect(c?.tags).toContain("seguimiento");
    expect(c?.tags).toContain("seguimiento_manual");
    // Exclusión mutua: el del modo automático no puede quedar puesto.
    expect(c?.tags ?? []).not.toContain("seguimiento_recupero");
  }, 30_000);

  it("y escribe la situación en el custom field, con el label exacto del dropdown", async () => {
    // El contexto no se hereda del hook: ver el comentario del `beforeAll`.
    activar(credenciales);
    const c = await ghlReal.obtenerContacto(contactoId);
    const valor =
      c?.customFields?.["contact.nivel_de_inters_seguimiento"] ??
      c?.customFields?.["nivel_de_inters_seguimiento"];
    expect(valor).toBe("Dudando");
  }, 30_000);
});

/** Lectura contra la cuenta real. Sin efectos: solo GET. */
describeSi("integración — lectura de GHL real", () => {
  it("lee un contacto real del territorio del closer", async () => {
    process.env.GHL_MODO = "real";
    const cred = await import("./credenciales");
    const { ORG_PRINCIPAL } = await import("./repo");
    // La empresa se abre DESPUÉS de resolverla, y dentro del propio test: el contexto de
    // `enterWith` no cruza el borde de una función async (ver el `beforeAll` del primer bloque).
    cred.activar(await cred.resolverCredenciales(ORG_PRINCIPAL));
    const { ghlReal } = await import("./ghl/real");

    const conexion = await ghlReal.verificarConexion();
    expect(conexion.ok).toBe(true);
    if (!conexion.ok) return;

    // Los cuatro que este módulo escribe o lee tienen que existir en la cuenta.
    for (const tag of [
      "seguimiento",
      "seguimiento_recupero",
      "seguimiento_manual",
      "zona_closer",
    ]) {
      expect(conexion.tags.map((t) => t.toLowerCase())).toContain(tag);
    }
    expect(conexion.customFields).toContain(
      "contact.nivel_de_inters_seguimiento",
    );
  });
});

/**
 * ── Crear una empresa, de punta a punta ────────────────────────────────
 *
 * Este endpoint **nunca había funcionado**. `closer_org_config.org_id` es la PRIMARY KEY, es
 * `not null` y no tiene default, y el INSERT no lo mandaba: todo intento moría con
 * `null value in column "org_id" ... violates not-null constraint`. No se notó durante toda la
 * fase 7 porque la única empresa que existe —ARIA— la sembró la migración `018` con el UUID
 * escrito a mano. El panel se construyó, se documentó y jamás se ejercitó creando una de verdad.
 *
 * Ningún test offline podía cazarlo: `tsc` está contento (la columna no aparece en el tipo del
 * insert) y la regla vive en el esquema, no en el código. Por eso el guard va acá, contra la base
 * real — es el único lugar donde "¿este INSERT entra?" es una pregunta que se pueda responder.
 *
 * Va bajo la doble compuerta porque escribe. Se limpia solo, y `es_principal: false` garantiza que
 * el trigger `closer_org_config_protegida` no lo bloquee al borrar.
 */
describeEscritura("integración — crear empresa (escribe en SOFIA)", () => {
  it("el INSERT de /api/admin/empresas entra y el slug repetido da 23505", async () => {
    // Este test usa `dbSinScope()` —está creando la empresa, así que no hay ninguna activa
    // todavía— y por eso no necesita abrir contexto.
    const { randomUUID } = await import("node:crypto");
    const { dbSinScope } = await import("./db");

    const slug = `zz-test-${Date.now().toString(36)}`;
    const orgId = randomUUID();

    const { data, error } = await dbSinScope()
      .from("closer_org_config")
      .insert({
        // La línea que faltaba. Sin ella todo lo de abajo es inalcanzable.
        org_id: orgId,
        nombre: "ZZ TEST — borrar",
        slug,
        zona_horaria: "America/Bogota",
        canales_sin_seguimiento_automatico: ["instagram"],
        activa: true,
        es_principal: false,
      })
      .select("org_id, slug, activa, es_principal")
      .single();

    expect(error?.message ?? null).toBeNull();
    expect(data).toMatchObject({
      org_id: orgId,
      slug,
      activa: true,
      es_principal: false,
    });

    /**
     * El endpoint traduce `23505` a un 409 "ya existe una empresa con ese identificador". Se
     * verifica que el código sea ese y no otro: si el índice único desapareciera, el handler
     * seguiría compilando y dos empresas podrían compartir slug — que es la clave por la que el
     * login resuelve a quién pertenece un usuario.
     */
    const dup = await dbSinScope()
      .from("closer_org_config")
      .insert({
        org_id: randomUUID(),
        nombre: "ZZ DUP",
        slug,
        activa: true,
        es_principal: false,
      })
      .select("org_id")
      .single();
    expect(dup.error?.code).toBe("23505");

    const { error: errBorrar } = await dbSinScope()
      .from("closer_org_config")
      .delete()
      .eq("org_id", orgId);
    expect(errBorrar?.message ?? null).toBeNull();
  }, 30_000);
});

/* ══════════════════════ El checklist de alta (§4.1) ══════════════════════ */

/**
 * Se prueba acá y no en `_alta.test.ts` porque lo que hay que verificar **es el dato real**: que el
 * checklist no diga "falta el PIT" sobre ARIA.
 *
 * Es el error que la primera versión del endpoint sí cometía. Leía `closer_org_config.ghl_pit_cifrado`
 * y esa columna está vacía para ARIA: su PIT vive en la variable `GHL_PIT` desde antes del
 * multi-empresa, y `resolverCredenciales()` lo resuelve con el fallback de la principal. El
 * checklist habría marcado como incompleta a la única empresa que sin duda opera — y un checklist
 * que se equivoca en el caso que todos conocen es un checklist que nadie vuelve a abrir.
 *
 * Un unit test con datos sintéticos no lo agarra: hay que preguntarle a la base cuál es el estado
 * de verdad. Por eso vive en la suite de integración.
 */
describeSi(
  "integración — el checklist de alta lee credenciales resueltas",
  () => {
    it("ARIA resuelve su PIT aunque la columna esté vacía, y queda anotado como global", async () => {
      const { resolverCredenciales } = await import("./credenciales.js");
      const { dbSinScope } = await import("./db.js");

      const cred = await resolverCredenciales(ORG_PRINCIPAL_ID);

      // El PIT existe resuelto…
      expect(
        cred.ghlPit,
        "ARIA sin PIT resuelto: el fallback de la principal se rompió",
      ).toBeTruthy();
      expect(cred.ghlLocationId).toBeTruthy();

      // …y la columna está vacía, que es justo lo que hacía fallar a la versión anterior.
      const { data } = await dbSinScope()
        .from("closer_org_config")
        .select("ghl_pit_cifrado")
        .eq("org_id", ORG_PRINCIPAL_ID)
        .maybeSingle();
      const enColumna =
        (data as { ghl_pit_cifrado: string | null } | null)?.ghl_pit_cifrado ??
        null;

      if (enColumna === null) {
        /**
         * Mientras siga así, `desdeEntorno` tiene que decirlo. Es lo que le permite al checklist
         * distinguir "cargado por esta empresa" de "apoyado en una variable global" — las dos
         * funcionan, y no son lo mismo.
         */
        expect(cred.desdeEntorno).toContain("GHL_PIT");
      } else {
        // Alguien cargó el PIT en la base: entonces NO puede venir del entorno.
        expect(cred.desdeEntorno).not.toContain("GHL_PIT");
      }
    });

    /**
     * El otro lado de la moneda, y el bug que la `027` vino a cerrar: una empresa cliente **no** hereda
     * las credenciales de ARIA. Si este test empieza a fallar, el fallback dejó de estar restringido a
     * la principal y una empresa a medio configurar está operando contra la subcuenta de otra.
     */
    it("una empresa que no es la principal NO hereda el PIT global", async () => {
      const { resolverCredenciales } = await import("./credenciales.js");
      const { dbSinScope } = await import("./db.js");

      const { data } = await dbSinScope()
        .from("closer_org_config")
        .select("org_id, nombre, ghl_pit_cifrado")
        .eq("es_principal", false)
        .limit(1);

      const otra = (data ?? [])[0] as
        | { org_id: string; nombre: string; ghl_pit_cifrado: string | null }
        | undefined;
      if (!otra) return; // Todavía no hay una segunda empresa: nada que verificar.

      const cred = await resolverCredenciales(otra.org_id);
      expect(
        cred.desdeEntorno,
        `"${otra.nombre}" heredó una credencial global`,
      ).not.toContain("GHL_PIT");
      if (!otra.ghl_pit_cifrado) expect(cred.ghlPit).toBeNull();
    });
  },
);
