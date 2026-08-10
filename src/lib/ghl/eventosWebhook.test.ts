/**
 * Paridad entre el catálogo de eventos y el switch del handler.
 *
 * El tipo `EventoGhl` y el guard `EVENTOS_CONOCIDOS` ya derivan del catálogo, así que no pueden
 * divergir. Lo único que sigue siendo una lista aparte es el `switch` de `api/webhooks/ghl.ts` —
 * sus `case "..."` son literales— y este test es lo que ata esa última copia:
 *
 *   · Un evento agregado al catálogo sin su `case` sería una URL que el panel ofrece y que el
 *     handler guarda sin interpretar. El cliente la pega, GHL dispara, y nada pasa — el modo de
 *     fallar silencioso que este repo viene cazando.
 *   · Un `case` agregado sin su entrada en el catálogo funcionaría, pero el guard lo cortaría
 *     antes (deriva del catálogo), o sea: código muerto detrás de un `if`.
 *
 * Se lee el FUENTE con regex en vez de importar el handler, a propósito: `ghl.ts` arrastra la
 * capa de base y el adapter de GHL, y para comparar dos listas no hace falta nada de eso. Es la
 * misma técnica de `enDesarrollo.test.ts` con `AUDITORES_ACTIVOS` y de `aislamiento.test.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENTOS_CONOCIDOS, EVENTOS_WEBHOOK, urlDeEvento } from "./eventosWebhook";

const AQUI = dirname(fileURLToPath(import.meta.url)); // …/src/lib/ghl
const fuente = readFileSync(resolve(AQUI, "..", "..", "..", "api", "webhooks", "ghl.ts"), "utf8");

/** Los `case "<evento>":` del switch, extraídos del fuente. */
const casesDelSwitch = [...fuente.matchAll(/case\s+"([a-z_.]+)"\s*:/g)].map((m) => m[1]);

describe("eventosWebhook · el catálogo y el switch del handler no pueden divergir", () => {
  it("se pudo leer el switch (el test no se rompió en silencio)", () => {
    expect(casesDelSwitch.length, "no se encontró ningún `case` en api/webhooks/ghl.ts").toBeGreaterThan(0);
  });

  it("cada evento del catálogo tiene su case en el handler", () => {
    for (const e of EVENTOS_WEBHOOK) {
      expect(casesDelSwitch, `"${e.evento}" está en el catálogo y el switch no lo maneja`).toContain(e.evento);
    }
  });

  it("cada case del handler está en el catálogo", () => {
    for (const c of casesDelSwitch) {
      expect(
        EVENTOS_CONOCIDOS,
        `el switch maneja "${c}" y el catálogo no lo lista: el guard lo corta antes de llegar (código muerto), ` +
          `y el panel nunca ofrece su URL`,
      ).toContain(c);
    }
  });

  it("el handler deriva su guard del catálogo en vez de tener su propia lista", () => {
    expect(fuente).toMatch(/import \{ EVENTOS_CONOCIDOS, type EventoGhl \} from "\.\.\/\.\.\/src\/lib\/ghl\/eventosWebhook\.js"/);
    // Y la lista vieja no volvió a aparecer como literal propio del handler.
    expect(fuente).not.toMatch(/const EVENTOS_CONOCIDOS\s*[:=]/);
  });

  it("los eventos son URL-safe tal cual (sin encoding sorpresa en el query param)", () => {
    for (const e of EVENTOS_WEBHOOK) {
      // El handler compara el string exacto: si encodeURIComponent lo cambiara, el valor que
      // llega por la URL no matchearía el case y el evento se guardaría sin interpretar.
      expect(encodeURIComponent(e.evento)).toBe(e.evento);
      expect(urlDeEvento("https://x/api/webhooks/ghl", e.evento)).toBe(`https://x/api/webhooks/ghl?evento=${e.evento}`);
    }
  });

  it("cada entrada tiene título y descripción no vacíos — es lo que lee el cliente al configurar", () => {
    for (const e of EVENTOS_WEBHOOK) {
      expect(e.titulo.trim().length, `"${e.evento}" sin título`).toBeGreaterThan(0);
      expect(e.descripcion.trim().length, `"${e.evento}" sin descripción`).toBeGreaterThan(20);
    }
  });
});
