/**
 * El backfill, en lo que puede fallar sin que se note.
 *
 * Son tests sobre el texto del fuente: lo que hay que impedir acá no es un valor mal calculado
 * sino tres olvidos que no rompen nada visible — paginar sin orden, gastar el lote en contactos
 * congelados, y decir `ok: true` con todo fallado. Los tres salieron de mandar a revisar el
 * código ANTES de correrlo contra producción, y los tres tienen la misma forma: el barrido
 * termina, responde 200, y lo que hizo no es lo que dice.
 *
 * El guion bajo del nombre: Vercel publica todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(import.meta.dirname, "../..");
const leer = (rel: string) => readFileSync(resolve(RAIZ, rel), "utf8");

const LIB = leer("api/_lib/backfillMensajes.ts");
const ENDPOINT = leer("api/mensajes-respaldo.ts");

describe("paginar sin orden es contar mal en silencio", () => {
  /**
   * Postgres no garantiza NINGÚN orden sin `ORDER BY`, así que dos páginas seguidas pueden
   * repetir una fila y saltearse otra. El webhook inserta mensajes todo el tiempo, que es el
   * escenario exacto donde eso pasa. Probado contra la base: hoy no se reproduce (el plan es un
   * seq scan estable), pero la garantía no existe — y el síntoma sería un conteo mal hecho, no
   * un error.
   */
  it("todasLasFilas ordena antes de paginar", () => {
    const i = LIB.indexOf("async function todasLasFilas");
    expect(i, "no se encontró todasLasFilas").toBeGreaterThan(-1);
    // Hasta el final del archivo: es la última función, y acotar por caracteres hacía que el
    // test fallara al crecer un comentario — un test que se rompe por documentar es un mal test.
    const cuerpo = LIB.slice(i);
    expect(cuerpo).toContain(".order(");
    expect(cuerpo).toContain(".range(");
    // El orden tiene que ir ANTES del range, o pagina sobre un conjunto sin ordenar.
    expect(cuerpo.indexOf(".order(")).toBeLessThan(cuerpo.indexOf(".range("));
  });

  /** Y se sigue pidiendo de a páginas: un `select` pelado devuelve 1000 y se calla. */
  it("y sigue paginando, que es de donde salió todo esto", () => {
    expect(LIB).toContain("PAGINA_FILAS");
    expect(LIB).toMatch(/lote\.length < PAGINA_FILAS/);
  });
});

describe("el lote no se gasta en quien no hay que mirar", () => {
  /**
   * `congelado` = el contacto no está en ningún territorio, y la regla del proyecto es no gastar
   * una llamada más de GHL en él. Sin actividad suelen tener pocos mensajes, así que el orden
   * "más vacíos primero" los ponía AL FRENTE: con `?tope=60`, el lote entero podía irse en los
   * que no correspondía tocar.
   */
  it("los congelados quedan fuera", () => {
    expect(LIB).toContain("!c.congelado");
    expect(LIB).toContain("congelado: boolean");
  });

  /**
   * Sin desempate, dos contactos con la misma cantidad de mensajes quedan en el orden que
   * devuelva la base — distinto entre corridas. Partir el trabajo en tandas necesita que la lista
   * sea LA MISMA cada vez, o una tanda se saltea lo que otra ya pasó.
   */
  it("y el orden desempata, para que las tandas no se pisen", () => {
    expect(LIB).toContain("localeCompare");
  });

  it("el cursor existe y recorta desde ahí", () => {
    expect(LIB).toMatch(/contactosParaBackfill\([\s\S]{0,80}desde = 0/);
    expect(LIB).toContain(".slice(desde, desde + limite)");
  });
});

describe("cortar antes de que Vercel corte", () => {
  /**
   * `maxDuration` es 300 s y Vercel mata sin avisar: se pierde el reporte entero y no queda forma
   * de saber cuántos se rellenaron ni dónde retomar. 60 contactos × hasta 6 llamadas a ~400 ms
   * son ~145 s, y `?tope=200` está permitido — se pasa.
   */
  it("el backfill acepta un plazo y lo respeta", () => {
    expect(LIB).toContain("hasta?: number");
    expect(LIB).toMatch(/if \(opts\.hasta && Date\.now\(\) > opts\.hasta\)/);
  });

  /** Cortar sin decirlo sería peor: parecería que terminó. */
  it("y cuando corta, lo dice y cuenta lo que quedó", () => {
    expect(LIB).toContain("cortadoPorTiempo");
    expect(LIB).toContain("pendientes");
  });

  it("el endpoint le pasa un plazo menor que su propio maxDuration", () => {
    expect(ENDPOINT).toContain("PRESUPUESTO_MS");
    const m = /const PRESUPUESTO_MS = ([\d_]+)/.exec(ENDPOINT);
    expect(m, "no se encontró PRESUPUESTO_MS").toBeTruthy();
    const ms = Number((m?.[1] ?? "0").replace(/_/g, ""));
    // 300_000 es el maxDuration declarado en vercel.json para este endpoint.
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300_000);
  });
});

describe("no reportar un éxito que no ocurrió", () => {
  /**
   * `backfillMensajes` junta los errores por contacto y sigue —está bien, uno roto no puede
   * tumbar a los otros 59—, pero el endpoint solo miraba los fallos a nivel EMPRESA. Los 60
   * contactos podían fallar uno por uno y la respuesta decía `ok: true`.
   */
  it("un contacto fallado hace que la empresa no sea un éxito", () => {
    expect(ENDPOINT).toContain("if (r.errores.length > 0) fallaron++;");
  });

  it("y la respuesta dice dónde retomar en vez de dejarlo a la adivinanza", () => {
    expect(ENDPOINT).toContain("proximoDesde");
    expect(ENDPOINT).toContain("totalContactos");
  });
});
