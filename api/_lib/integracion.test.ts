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

const activa = process.env.INTEGRACION === "1" && Boolean(process.env.SUPABASE_URL);
const describeSi = activa ? describe : describe.skip;

/** La empresa del contacto de prueba. Duplica `ORG_PRINCIPAL` para no importar dentro de un `it`. */
const ORG_PRINCIPAL_ID = "00000000-0000-0000-0000-000000000001";

/** Contacto de prueba, inexistente en GHL a propósito: nada que se le pueda enviar. */
const CONTACTO = "integracion_test_no_existe_en_ghl";

describeSi("integración — Supabase real, GHL en stub", () => {
  let db: typeof import("./repo").db;
  let registrarSeguimiento: typeof import("./seguimientos").registrarSeguimiento;

  beforeAll(async () => {
    // El modo se fija ANTES de importar: el selector del adapter lo lee al construirse.
    process.env.GHL_MODO = "stub";
    ({ db } = await import("./repo"));
    ({ registrarSeguimiento } = await import("./seguimientos"));

    /**
     * Desde el 2026-08-07 `db()` saca la organización del contexto y lanza si no hay ninguna.
     * Este test corre fuera de todo handler, así que la abre él mismo — contra la empresa
     * principal, que es donde vive el contacto de prueba.
     */
    const { activar, resolverCredenciales } = await import("./credenciales");
    const { ORG_PRINCIPAL } = await import("./repo");
    activar(await resolverCredenciales(ORG_PRINCIPAL));
  });

  afterAll(async () => {
    if (!db) return;
    // Orden obligado: los eventos referencian el seguimiento con `no action`, así que hay
    // que sacarlos primero o el borrado del seguimiento falla — en silencio, porque
    // supabase-js no lanza. Por eso se verifica el resultado en vez de confiar.
    for (const tabla of ["closer_ghl_outbox", "closer_contacto_eventos", "closer_seguimientos", "closer_contacto_tarea"]) {
      const { error } = await db().from(tabla).delete().eq("ghl_contact_id", CONTACTO);
      if (error) throw new Error(`limpieza de ${tabla}: ${error.message}`);
    }
    const { count } = await db()
      .from("closer_seguimientos")
      .select("*", { count: "exact", head: true })
      .eq("ghl_contact_id", CONTACTO);
    if (count) throw new Error(`la limpieza dejó ${count} seguimiento(s) de prueba en SOFIA`);
  });

  it("registra un seguimiento manual y lo deja fuera de la cola de hoy", async () => {
    const r = await registrarSeguimiento({
      ghlContactId: CONTACTO,
      situacion: "dudando",
      modo: "manual",
      preset: "en_3_dias",
      nota: "Nota de la prueba de integración.",
      idempotencyKey: `test-manual-${Date.now()}`,
    });

    expect(r.seguimientoId).toBeTruthy();
    expect(r.toast).toMatch(/Seguimiento programado/);

    const { data } = await db().from("closer_seguimientos_de_hoy").select("*").eq("ghl_contact_id", CONTACTO);
    expect(data ?? []).toHaveLength(0); // vence en 3 días, hoy no toca
  });

  it("la tarea del día queda completada — va a Completadas Hoy", async () => {
    const { data } = await db().from("closer_contacto_tarea").select("completada_dia").eq("ghl_contact_id", CONTACTO).single();
    const { data: hoy } = await db().rpc("closer_hoy_org", { p_org_id: ORG_PRINCIPAL_ID });
    expect(data?.completada_dia).toBe(hoy);
  });

  it("la nota se persiste, para poder leerla el día del seguimiento", async () => {
    const { data } = await db().from("closer_seguimientos").select("nota").eq("ghl_contact_id", CONTACTO).eq("estado", "pendiente").single();
    expect(data?.nota).toBe("Nota de la prueba de integración.");
  });

  it("el stub registra la intención de los tres efectos, sin aplicarlos", async () => {
    const { data } = await db().from("closer_ghl_outbox").select("operacion, args, estado").eq("ghl_contact_id", CONTACTO);
    const ops = (data ?? []).map((o) => o.operacion).sort();

    expect(ops).toEqual(["aplicar_tag", "escribir_campo", "remover_tag"]);
    expect((data ?? []).every((o) => o.estado === "omitido_stub")).toBe(true);

    const aplicar = (data ?? []).find((o) => o.operacion === "aplicar_tag");
    expect(aplicar?.args?.tags).toEqual(["seguimiento", "seguimiento_manual"]);

    // El campo lleva el LABEL exacto del dropdown de GHL, no el slug interno.
    const campo = (data ?? []).find((o) => o.operacion === "escribir_campo");
    expect(campo?.args?.campo).toBe("contact.nivel_de_inters_seguimiento");
    expect(campo?.args?.valor).toBe("Dudando");
  });

  it("un segundo seguimiento reemplaza al primero, dejando uno solo abierto", async () => {
    await registrarSeguimiento({
      ghlContactId: CONTACTO,
      situacion: "muy_interesado",
      modo: "automatico",
      idempotencyKey: `test-auto-${Date.now()}`,
    });

    const { data } = await db().from("closer_seguimientos").select("estado, modo, serie_key").eq("ghl_contact_id", CONTACTO);
    const abiertos = (data ?? []).filter((s) => s.estado === "pendiente" || s.estado === "agotado");

    expect(abiertos).toHaveLength(1);
    expect(abiertos[0].modo).toBe("automatico");
    expect(abiertos[0].serie_key).toBe("recupero");
    expect((data ?? []).some((s) => s.estado === "reemplazado")).toBe(true);
  });

  it("la serie automática NO genera fila en la cola, aunque esté pendiente", async () => {
    const { data } = await db().from("closer_seguimientos_de_hoy").select("*").eq("ghl_contact_id", CONTACTO);
    expect(data ?? []).toHaveLength(0);
  });
});

/**
 * Escritura REAL en GHL, sobre un contacto de prueba que crea y borra el propio test.
 *
 * Doble compuerta — `INTEGRACION=1` **y** `INTEGRACION_ESCRITURA=1` — porque esto modifica
 * la cuenta de producción.
 *
 * Solo prueba el modo **manual**. Confirmado con Francisco: `seguimiento_manual` no tiene
 * ningún workflow enganchado, así que aplicarlo no envía nada. El modo automático queda
 * deliberadamente fuera: `seguimiento_recupero` dispara la serie Recupero, que manda tres
 * mensajes durante siete días, y eso no se deshace quitando el tag.
 *
 * El contacto se crea sin teléfono y con un email en `example.com`, que es el dominio
 * reservado para pruebas: aunque algo intentara enviarle, no llega a ninguna parte.
 */
const describeEscritura = activa && process.env.INTEGRACION_ESCRITURA === "1" ? describe : describe.skip;

describeEscritura("integración — ESCRITURA real en GHL", () => {
  let contactoId = "";
  let ghlReal: typeof import("./ghl/real").ghlReal;
  let db: typeof import("./repo").db;
  let registrarSeguimiento: typeof import("./seguimientos").registrarSeguimiento;

  const BASE = "https://services.leadconnectorhq.com";
  const cab = () => ({
    Authorization: `Bearer ${process.env.GHL_PIT ?? process.env.GHL_API_KEY}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  });

  beforeAll(async () => {
    process.env.GHL_MODO = "real";
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
    if (!contactoId) throw new Error(`No se pudo crear el contacto de prueba: ${JSON.stringify(j).slice(0, 300)}`);
  }, 30_000);

  afterAll(async () => {
    if (db) {
      for (const t of ["closer_ghl_outbox", "closer_contacto_eventos", "closer_seguimientos", "closer_contacto_tarea"]) {
        await db().from(t).delete().eq("ghl_contact_id", contactoId);
      }
    }
    if (contactoId) await fetch(`${BASE}/contacts/${contactoId}`, { method: "DELETE", headers: cab() });
  }, 30_000);

  it("el contacto de prueba nace con zona_closer y sin seguimiento", async () => {
    const c = await ghlReal.obtenerContacto(contactoId);
    expect(c?.tags).toContain("zona_closer");
    expect(c?.tags ?? []).not.toContain("seguimiento_manual");
  });

  it("registrar un seguimiento manual aplica los tags EN GHL de verdad", async () => {
    const r = await registrarSeguimiento({
      ghlContactId: contactoId,
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
    const c = await ghlReal.obtenerContacto(contactoId);
    const valor = c?.customFields?.["contact.nivel_de_inters_seguimiento"] ?? c?.customFields?.["nivel_de_inters_seguimiento"];
    expect(valor).toBe("Dudando");
  }, 30_000);
});

/** Lectura contra la cuenta real. Sin efectos: solo GET. */
describeSi("integración — lectura de GHL real", () => {
  it("lee un contacto real del territorio del closer", async () => {
    process.env.GHL_MODO = "real";
    const { ghlReal } = await import("./ghl/real");

    const conexion = await ghlReal.verificarConexion();
    expect(conexion.ok).toBe(true);
    if (!conexion.ok) return;

    // Los cuatro que este módulo escribe o lee tienen que existir en la cuenta.
    for (const tag of ["seguimiento", "seguimiento_recupero", "seguimiento_manual", "zona_closer"]) {
      expect(conexion.tags.map((t) => t.toLowerCase())).toContain(tag);
    }
    expect(conexion.customFields).toContain("contact.nivel_de_inters_seguimiento");
  });
});
