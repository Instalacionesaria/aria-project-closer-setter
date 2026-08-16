/**
 * Los tags del bot son POR AGENTE, y el auditor tiene que apagar al que falló.
 *
 * ── El cambio (2026-08-16, decisión de Fabio) ──
 *
 * Antes había un `bot_activado` y un `bot_pausado_fallo` para los dos agentes de chat. Con los
 * dos auditores corriendo eso deja de alcanzar: GHL necesita saber **cuál** de los dos bots
 * pausar, y un tag único los pausaría a los dos o a ninguno.
 *
 *     Appointment Flow (post-agenda) → bot_activado_appflow  / bot_desactivado_appflow
 *     Lead Flow        (pre-agenda)  → bot_activado_leadflow / bot_desactivado_leadflow
 *
 * ── Qué fija cada test ──
 *
 * El modo de fallar que importa acá es **cruzar los cables**: que el auditor del closer apague el
 * bot del setter. Eso no rompe nada visible —el tag se aplica, GHL pausa un bot, el análisis se
 * guarda— y el efecto es que un agente que trabajaba bien se apaga solo mientras el que falló
 * sigue atendiendo. No hay test de comportamiento que lo agarre sin GHL real, así que se fija la
 * derivación pura y el hecho de que la escritura salga de ella.
 *
 * El guion bajo del nombre: Vercel publica todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TAGS_BOT,
  TAGS_BOT_POR_TERRITORIO,
  TAGS_FALLO_AUDITOR,
} from "../../src/lib/ghl/contrato.js";
import { tagFalloDe } from "./analizador.js";

const RAIZ = resolve(import.meta.dirname, "../..");
const fuente = (rel: string) =>
  readFileSync(resolve(RAIZ, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("cada territorio apaga a SU agente", () => {
  it("post-agenda apaga el appflow, pre-agenda el leadflow", () => {
    expect(tagFalloDe("closer")).toBe("bot_desactivado_appflow");
    expect(tagFalloDe("setter")).toBe("bot_desactivado_leadflow");
  });

  /** El cruce es el bug que importa: apagar al agente que NO falló. */
  it("nunca devuelve el tag del otro", () => {
    expect(tagFalloDe("closer")).not.toBe(tagFalloDe("setter"));
    expect(tagFalloDe("closer")).not.toContain("leadflow");
    expect(tagFalloDe("setter")).not.toContain("appflow");
  });

  it("el par activado/desactivado de cada territorio nombra al mismo agente", () => {
    for (const [territorio, par] of Object.entries(TAGS_BOT_POR_TERRITORIO)) {
      const agente = territorio === "closer" ? "appflow" : "leadflow";
      expect(par.activado).toContain(agente);
      expect(par.desactivado).toContain(agente);
    }
  });
});

describe("el auditor escribe el tag derivado, no un literal", () => {
  const ANALIZADOR = fuente("api/_lib/analizador.ts");

  /**
   * Si alguien vuelve a poner un literal acá, el auditor apaga siempre al mismo agente sin que
   * nada falle — y el del otro territorio queda pausado por un error que no cometió.
   */
  it("aplicarTags recibe tagFalloDe(territorio)", () => {
    const i = ANALIZADOR.indexOf("aplicarTags({");
    expect(i, "no se encontró la aplicación del tag").toBeGreaterThan(-1);
    const bloque = ANALIZADOR.slice(i, i + 220);
    expect(bloque).toContain("tagFalloDe(territorio)");
  });

  it("y ya no queda ningún literal de bot_pausado_fallo en el motor", () => {
    expect(ANALIZADOR).not.toContain('"bot_pausado_fallo"');
  });
});

describe("leer sigue siendo una sola pregunta: ¿está marcado?", () => {
  /**
   * Para Urgentes y para el portón "ya tiene veredicto" da igual cuál agente falló: el contacto
   * necesita a un humano. Lo que NO puede pasar es que un contacto marcado por el leadflow no
   * aparezca en la cola porque alguien miró solo el tag del appflow.
   */
  it("los tres tags de fallo están en la lista de lectura", () => {
    expect([...TAGS_FALLO_AUDITOR].sort()).toEqual([
      "bot_desactivado_appflow",
      "bot_desactivado_leadflow",
      "bot_pausado_fallo",
    ]);
  });

  /**
   * El legado no se borra: al hacer el cambio había un contacto en GHL con `bot_pausado_fallo`
   * puesto por el propio auditor. Sacarlo de la lista lo habría hecho desaparecer de Urgentes en
   * silencio, con la alerta sin resolver.
   */
  it("incluido el legado, que todavía existe en GHL", () => {
    expect(TAGS_FALLO_AUDITOR).toContain(TAGS_BOT.botPausadoFallo.valor);
  });

  /**
   * El parecido peligroso: `bot_desactivado_postcall` empieza igual que los dos nuevos y significa
   * lo contrario —el ciclo terminó bien—. Si entrara acá, doce contactos que ya tuvieron su sales
   * call aparecerían como urgencias.
   */
  it("y NO el de postcall, que empieza igual y no es un fallo", () => {
    expect(TAGS_FALLO_AUDITOR).not.toContain(
      TAGS_BOT.botDesactivadoPostcall.valor,
    );
  });

  it("las cuatro colas leen la lista, no un tag suelto", () => {
    for (const rel of [
      "api/_lib/miDia.ts",
      "api/_lib/miDiaSetter.ts",
      "api/setter/urgentes.ts",
      "api/agentes/auditor-estado.ts",
    ]) {
      expect(fuente(rel), `${rel} no usa tieneFalloDeAuditor`).toContain(
        "tieneFalloDeAuditor(",
      );
    }
  });

  /** Al resolver se quitan los tres: no se sabe con cuál quedó marcado, y sobra pedirlos todos. */
  it("y al resolver por humano se quitan todos", () => {
    expect(fuente("api/agentes/alertas.ts")).toContain(
      "tags: [...TAGS_FALLO_AUDITOR]",
    );
  });
});
