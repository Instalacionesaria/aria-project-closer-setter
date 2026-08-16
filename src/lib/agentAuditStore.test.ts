import { describe, expect, it } from "vitest";
import {
  componerAgentes,
  groupAlerts,
  AGENTS_CATALOGO,
} from "./agentAuditStore";
import type { AgenteTextoMetricas, CasoAlerta, PatronAlerta } from "./api";

const AHORA = Date.parse("2026-08-10T12:00:00Z");

const patron = (
  errorCode: string,
  over: Partial<PatronAlerta> = {},
): PatronAlerta => ({
  agenteId: "appointment-flow-ai",
  errorCode,
  titulo: `Título de ${errorCode}`,
  categoria: "comportamiento",
  severidad: "rojo",
  diagnostico: "algo pasó",
  fragmentoPrompt: null,
  promptSeccion: null,
  correccionTipo: "agregado",
  correccion: "no hagas eso",
  promptRef: null,
  promptDesactualizado: false,
  textoDe: "2026-08-09T12:00:00Z",
  ajustadoEl: null,
  reincidenteDesde: null,
  ...over,
});

const caso = (
  errorCode: string,
  over: Partial<CasoAlerta> = {},
): CasoAlerta => ({
  id: `${errorCode}-${Math.random().toString(36).slice(2)}`,
  agenteId: "appointment-flow-ai",
  errorCode,
  ghlContactId: "abc123",
  nombre: "Contacto",
  analizadoEl: "2026-08-09T12:00:00Z",
  estado: "activo",
  ghlUrl: null,
  ...over,
});

describe("groupAlerts", () => {
  /**
   * La invariante que justifica agrupar en el cliente y no en SQL. El desfase que documentó
   * §32.D ("×15 casos" mostrando 2 ejemplos) venía de que el conteo era un `COUNT(*)`
   * desacoplado de la lista que se paginaba. Acá no puede volver a pasar.
   */
  it("casesCount es siempre la cantidad de casos que viajan", () => {
    const grupos = groupAlerts(
      [patron("promesa_vacia")],
      [caso("promesa_vacia"), caso("promesa_vacia")],
      AHORA,
    );
    expect(grupos[0].casesCount).toBe(2);
    expect(grupos[0].casesCount).toBe(grupos[0].casos.length);
  });

  it("agrupa por agente + errorCode, no solo por errorCode", () => {
    const grupos = groupAlerts(
      [
        patron("mismo_codigo"),
        patron("mismo_codigo", { agenteId: "lead-flow-ai" }),
      ],
      [
        caso("mismo_codigo"),
        caso("mismo_codigo", { agenteId: "lead-flow-ai" }),
      ],
      AHORA,
    );
    expect(grupos).toHaveLength(2);
    expect(grupos.every((g) => g.casesCount === 1)).toBe(true);
  });

  /** Un patrón cuyos casos quedaron todos fuera de la ventana sigue existiendo, pero vacío. */
  it("un patrón sin casos no rompe ni inventa un conteo", () => {
    const grupos = groupAlerts([patron("huerfano")], [], AHORA);
    expect(grupos[0].casesCount).toBe(0);
    expect(grupos[0].abierto).toBe(false);
    expect(grupos[0].todosParcheados).toBe(false);
  });

  it("abierto = hay algún activo o algún resuelto por humano sin parchear", () => {
    const soloParcheados = groupAlerts(
      [patron("x")],
      [caso("x", { estado: "parcheado" })],
      AHORA,
    )[0];
    expect(soloParcheados.abierto).toBe(false);
    expect(soloParcheados.todosParcheados).toBe(true);

    const salvado = groupAlerts(
      [patron("x")],
      [caso("x", { estado: "resuelto_por_humano" })],
      AHORA,
    )[0];
    expect(salvado.abierto).toBe(true);
    expect(salvado.hayActivos).toBe(false);
    expect(salvado.soloResueltosPorHumano).toBe(true);
  });

  it("con un activo al lado, ya no es 'solo resuelto por humano'", () => {
    const g = groupAlerts(
      [patron("x")],
      [caso("x"), caso("x", { estado: "resuelto_por_humano" })],
      AHORA,
    )[0];
    expect(g.hayActivos).toBe(true);
    expect(g.soloResueltosPorHumano).toBe(false);
  });

  it("diasAbierto se mide desde el caso MÁS VIEJO del grupo", () => {
    const g = groupAlerts(
      [patron("x")],
      [
        caso("x", { analizadoEl: "2026-08-09T12:00:00Z" }),
        caso("x", { analizadoEl: "2026-08-05T12:00:00Z" }),
      ],
      AHORA,
    )[0];
    expect(g.diasAbierto).toBe(5);
  });
});

describe("componerAgentes", () => {
  const medido: AgenteTextoMetricas = {
    id: "appointment-flow-ai",
    metric: "68%",
    delta: null,
    subtext: null,
    sentiment: { positivos: 70, neutrales: 20, molestos: 10 },
    ops: [{ label: "Conversaciones", value: "86" }],
    history: [],
    analisis: 12,
    // Menor que `analisis` a propósito: 2 de esos 12 son anteriores a la `031` y no tienen nivel,
    // así que no pueden ser verdes. El chip dice "9 verdes de 10", nunca "de 12" (`040`).
    conVeredicto: 10,
    verdes: 9,
  };

  /**
   * La diferencia con `conMetricasReales`, que es toda la tarea: aquella caía a un valor
   * sembrado cuando no había medición. Esta deja el `null` y la vista decide cómo mostrar la
   * ausencia — un cero y un "no medido" no son el mismo hecho.
   */
  it("un agente sin medición queda en null, no en cero ni en un valor inventado", () => {
    const [leadFlow] = componerAgentes(
      AGENTS_CATALOGO.filter((a) => a.id === "lead-flow-ai"),
      [],
      ["appointment-flow-ai"],
    );
    expect(leadFlow.metric).toBeNull();
    expect(leadFlow.sentiment).toBeNull();
    expect(leadFlow.analisis).toBe(0);
    expect(leadFlow.ops).toEqual([]);
  });

  it("marca qué agentes tienen auditor", () => {
    const agentes = componerAgentes(
      AGENTS_CATALOGO,
      [medido],
      ["appointment-flow-ai"],
    );
    expect(
      agentes.find((a) => a.id === "appointment-flow-ai")!.tieneAuditor,
    ).toBe(true);
    expect(agentes.find((a) => a.id === "lead-flow-ai")!.tieneAuditor).toBe(
      false,
    );
    expect(
      agentes.filter((a) => a.type === "voz").every((a) => !a.tieneAuditor),
    ).toBe(true);
  });

  it("conserva el catálogo y superpone lo medido", () => {
    const [ap] = componerAgentes(
      AGENTS_CATALOGO.filter((a) => a.id === "appointment-flow-ai"),
      [medido],
      ["appointment-flow-ai"],
    );
    expect(ap.name).toBe("Appointment Flow AI");
    expect(ap.metric).toBe("68%");
    expect(ap.analisis).toBe(12);
  });

  /** Los 4 agentes tienen que estar siempre: la pestaña es el mapa de lo que falta construir. */
  it("el catálogo tiene los 4 agentes y solo el de post-agenda sin motivo de ausencia", () => {
    expect(AGENTS_CATALOGO).toHaveLength(4);
    const sinMotivo = AGENTS_CATALOGO.filter((a) => !a.porQueNoHayAuditor);
    expect(sinMotivo.map((a) => a.id)).toEqual(["appointment-flow-ai"]);
  });
});
