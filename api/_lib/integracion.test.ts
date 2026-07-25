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
    const { data: hoy } = await db().rpc("closer_hoy_org");
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
