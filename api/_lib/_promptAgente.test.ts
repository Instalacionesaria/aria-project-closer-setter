/**
 * De dónde saca el auditor el prompt del agente auditado (ESPEC §7.3 y §10).
 *
 * Esto decide **qué ve el modelo**, así que sus dos modos de fallar son caros y silenciosos:
 * leer de menos hace que el auditor emita consejos genéricos en vez de reemplazos citados, y
 * leer de la empresa equivocada hace que mida al agente de una contra las instrucciones de otra
 * y produzca hallazgos convincentes y falsos.
 *
 * El guion bajo del nombre del archivo no es decorativo: Vercel convierte en función serverless
 * todo `.ts` bajo `api/` y su único filtro es `/_`. Ver `api/admin/_usuarios.test.ts`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { conCredenciales, type Credenciales } from "./credenciales.js";
import { _limpiarCachePrompt, cargarPromptAgente, estadoDeLosPrompts } from "./promptAgente.js";

/** Una empresa mínima. Solo importan el nombre, el orgId y los prompts. */
function empresa(over: Partial<Credenciales> = {}): Credenciales {
  return {
    orgId: "11111111-1111-1111-1111-111111111111",
    nombre: "Empresa A",
    esPrincipal: false,
    activa: true,
    ghlPit: null,
    ghlLocationId: null,
    ghlWebhookSecret: null,
    ghlCalendarioId: null,
    anthropicKey: null,
    assistableToken: null,
    metaAdAccountId: null,
    metaToken: null,
    zonaHoraria: "America/Lima",
    promptAppointmentTexto: null,
    promptLeadTexto: null,
    promptAppointmentVoz: null,
    promptLeadVoz: null,
    desdeEntorno: [],
    ...over,
  };
}

afterEach(() => _limpiarCachePrompt());

describe("cargarPromptAgente · el prompt sale de la empresa activa", () => {
  it("lee el prompt del closer de su columna", async () => {
    const p = await conCredenciales(empresa({ promptAppointmentTexto: "Sos el Appointment Flow.\nConfirmá la cita." }), async () =>
      cargarPromptAgente("appointment-flow-ai"),
    );
    expect(p.presente).toBe(true);
    expect(p.texto).toContain("Appointment Flow");
    expect(p.lineas).toBe(2);
    expect(p.hash).toHaveLength(12);
  });

  it("lee el del setter de la SUYA, no la del closer", async () => {
    const cred = empresa({ promptAppointmentTexto: "el del closer", promptLeadTexto: "el del setter" });
    const [closer, setter] = await conCredenciales(cred, async () => [
      cargarPromptAgente("appointment-flow-ai"),
      cargarPromptAgente("lead-flow-ai"),
    ]);
    expect(closer.texto).toBe("el del closer");
    expect(setter.texto).toBe("el del setter");
  });

  describe("la ausencia es un estado normal, no un error", () => {
    it("sin prompt cargado devuelve ausente y NO lanza", async () => {
      const p = await conCredenciales(empresa(), async () => cargarPromptAgente("lead-flow-ai"));
      expect(p.presente).toBe(false);
      expect(p.texto).toBe("");
      expect(p.hash).toBe("ausente");
      expect(p.lineas).toBe(0);
    });

    it("un prompt de espacios en blanco es lo mismo que no tenerlo", async () => {
      const p = await conCredenciales(empresa({ promptLeadTexto: "   \n  " }), async () => cargarPromptAgente("lead-flow-ai"));
      expect(p.presente).toBe(false);
    });

    /**
     * A diferencia de `db()`, que lanza sin contexto. La asimetría es deliberada: una consulta
     * sin organización puede devolver datos de otra empresa; un prompt sin organización solo
     * hace que el auditor degrade a instrucción autónoma.
     */
    it("sin empresa activa devuelve ausente en vez de lanzar", () => {
      const p = cargarPromptAgente("appointment-flow-ai");
      expect(p.presente).toBe(false);
      expect(p.ruta).toContain("sin empresa activa");
    });
  });

  describe("el aislamiento entre empresas — lo que el caché podría romper", () => {
    /**
     * El bug que la clave por empresa existe para hacer imposible: una instancia caliente de
     * Vercel que ya cacheó el prompt de A sirviéndoselo al auditor de B.
     */
    it("dos empresas con prompts distintos NO se pisan en el caché", async () => {
      const a = empresa({ orgId: "aaaa", nombre: "A", promptAppointmentTexto: "prompt de A" });
      const b = empresa({ orgId: "bbbb", nombre: "B", promptAppointmentTexto: "prompt de B" });

      const pa = await conCredenciales(a, async () => cargarPromptAgente("appointment-flow-ai"));
      const pb = await conCredenciales(b, async () => cargarPromptAgente("appointment-flow-ai"));
      // Y de nuevo la primera: si el caché estuviera mal, acá volvería el de B.
      const pa2 = await conCredenciales(a, async () => cargarPromptAgente("appointment-flow-ai"));

      expect(pa.texto).toBe("prompt de A");
      expect(pb.texto).toBe("prompt de B");
      expect(pa2.texto).toBe("prompt de A");
      expect(pa.hash).not.toBe(pb.hash);
    });

    /** Una empresa SIN prompt no hereda el de la que sí tiene, ni por el caché. */
    it("la ausencia de una no se llena con el prompt de la otra", async () => {
      const conPrompt = empresa({ orgId: "cccc", nombre: "C", promptLeadTexto: "el de C" });
      const sinPrompt = empresa({ orgId: "dddd", nombre: "D" });

      await conCredenciales(conPrompt, async () => cargarPromptAgente("lead-flow-ai"));
      const d = await conCredenciales(sinPrompt, async () => cargarPromptAgente("lead-flow-ai"));

      expect(d.presente).toBe(false);
      expect(d.texto).toBe("");
    });
  });

  describe("el hash", () => {
    it("el mismo texto da el mismo hash; un texto distinto, otro", async () => {
      const uno = await conCredenciales(empresa({ orgId: "e1", promptLeadTexto: "igual" }), async () => cargarPromptAgente("lead-flow-ai"));
      const dos = await conCredenciales(empresa({ orgId: "e2", promptLeadTexto: "igual" }), async () => cargarPromptAgente("lead-flow-ai"));
      const tres = await conCredenciales(empresa({ orgId: "e3", promptLeadTexto: "distinto" }), async () => cargarPromptAgente("lead-flow-ai"));
      expect(uno.hash).toBe(dos.hash);
      expect(tres.hash).not.toBe(uno.hash);
    });

    /**
     * El hash sale del TEXTO, no de la columna `*_hash`. Si alguien editara la fila por SQL sin
     * tocar el hash guardado, el que vale para comparar contra `closer_hallazgo_agente` es el
     * del texto que el auditor está usando de verdad.
     */
    it("se recalcula del texto y no se hereda de ningún lado", async () => {
      const p = await conCredenciales(empresa({ promptLeadTexto: "abc" }), async () => cargarPromptAgente("lead-flow-ai"));
      // sha256("abc") empieza con ba7816bf8f01...
      expect(p.hash).toBe("ba7816bf8f01");
    });
  });

  describe("la referencia que ve un humano", () => {
    it("nombra la columna y la empresa, no una ruta de archivo", async () => {
      const p = await conCredenciales(empresa({ nombre: "ARIA IA", promptLeadTexto: "x" }), async () =>
        cargarPromptAgente("lead-flow-ai"),
      );
      expect(p.ruta).toBe("closer_org_config.prompt_lead_texto · ARIA IA");
      expect(p.ruta).not.toContain("docs/prompts");
    });
  });

  describe("estadoDeLosPrompts · lo que reporta el diagnóstico", () => {
    it("trae los dos agentes de texto sin exponer el contenido", async () => {
      const estado = await conCredenciales(empresa({ promptLeadTexto: "secreto del setter" }), async () => estadoDeLosPrompts());
      expect(Object.keys(estado).sort()).toEqual(["appointment-flow-ai", "lead-flow-ai"]);
      expect(estado["lead-flow-ai"].presente).toBe(true);
      expect(estado["appointment-flow-ai"].presente).toBe(false);
      // El contenido NO viaja: solo presencia, hash, líneas y de dónde salió.
      expect(JSON.stringify(estado)).not.toContain("secreto del setter");
    });
  });
});
