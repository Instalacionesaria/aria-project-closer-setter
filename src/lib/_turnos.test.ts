/**
 * `turnosDeLlamada`: el único lugar que interpreta la forma de Retell, y la frontera que decide
 * qué de una llamada llega al browser.
 *
 * Estos tests existen por dos motivos que no son estéticos:
 *
 *   1. `closer_llamadas.turnos` es JSON de un tercero **sin redactar** — `redactarSecretos()` se
 *      aplica al cuerpo crudo del inbox, no a esta columna. Si un día alguien "simplifica" el
 *      mapeo a `turnos: f.turnos`, los `metadata` de Retell (ids internos, latencias, y en un
 *      turno de herramienta los argumentos de la tool) viajarían a un endpoint que ven closer,
 *      setter y técnico. El test de abajo falla el día que eso pase.
 *   2. Un rol desconocido **no puede etiquetarse como el contacto**: sería afirmar que una persona
 *      real dijo algo que no sabemos quién dijo.
 */

import { describe, expect, it } from "vitest";
import { turnosDeLlamada } from "./assistable";

describe("turnosDeLlamada · la forma real de Retell", () => {
  /** Verificado contra la primera llamada contestada real (2026-08-10). */
  const REAL = [
    {
      role: "agent",
      content: "Hola Moises, te saluda Sofía. Llamo para confirmar tu reunión.",
      metadata: { assistant_id: "assistant-4c60", llm_first_token_duration_ms: 803 },
    },
    { role: "user", content: "Hola.", metadata: { telnyx_conversation_channel: "phone_call" } },
  ];

  it("traduce agent/user al vocabulario de la ficha", () => {
    const t = turnosDeLlamada(REAL);
    expect(t).toEqual([
      { rol: "agente", texto: "Hola Moises, te saluda Sofía. Llamo para confirmar tu reunión." },
      { rol: "contacto", texto: "Hola." },
    ]);
  });

  /**
   * EL test que importa: el `metadata` de Retell no sale de la base. Si esto falla, hay datos de
   * un tercero viajando al browser.
   */
  it("descarta metadata y cualquier clave que no sea rol y texto", () => {
    const salida = JSON.stringify(turnosDeLlamada(REAL));
    expect(salida).not.toContain("metadata");
    expect(salida).not.toContain("assistant_id");
    expect(salida).not.toContain("telnyx");
    expect(salida).not.toContain("llm_first_token_duration_ms");
    // Y ninguna clave de más en los objetos que sí salen.
    for (const t of turnosDeLlamada(REAL)) {
      expect(Object.keys(t).sort()).toEqual(["rol", "texto"]);
    }
  });

  it("una clave que parezca una credencial tampoco pasa, porque nada pasa salvo rol y texto", () => {
    const conSecreto = [{ role: "agent", content: "ok", metadata: { api_key: "sk-de-verdad" } }];
    expect(JSON.stringify(turnosDeLlamada(conSecreto))).not.toContain("sk-de-verdad");
  });
});

describe("turnosDeLlamada · lo que no se reconoce no se inventa", () => {
  /** La regla: un rol desconocido NUNCA se etiqueta como el contacto. */
  it("un rol desconocido queda como 'otro', no como contacto", () => {
    const t = turnosDeLlamada([
      { role: "tool", content: "buscar_disponibilidad({})" },
      { role: "system", content: "sesión iniciada" },
    ]);
    expect(t.map((x) => x.rol)).toEqual(["otro", "otro"]);
    expect(t.map((x) => x.rol)).not.toContain("contacto");
  });

  it("descarta turnos malformados sin tumbar los buenos", () => {
    const sucios = [
      { role: "agent", content: "Válido." },
      { role: "agent" },
      { content: "sin role" },
      "un string suelto",
      null,
      42,
      { role: "user", content: "   " },
    ];
    const limpios = turnosDeLlamada(sucios);
    expect(limpios).toEqual([{ rol: "agente", texto: "Válido." }]);
  });

  it("nada que no sea un array devuelve lista vacía, sin lanzar", () => {
    for (const basura of [null, undefined, {}, "texto", 7, true]) {
      expect(turnosDeLlamada(basura)).toEqual([]);
    }
  });

  it("recorta el texto pero no lo trunca", () => {
    const largo = "a".repeat(5000);
    expect(turnosDeLlamada([{ role: "user", content: `  ${largo}  ` }])[0].texto).toBe(largo);
  });
});
