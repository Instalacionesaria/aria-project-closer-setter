import { describe, expect, it } from "vitest";
import { STAGE_ORDER } from "../closerStore";
import { TAGS } from "./contrato";
import { RESULTADOS } from "./resultados";
import {
  ETAPAS_ORDEN,
  ETAPA_DE_ENTRADA,
  PRIORIDAD_DESENLACES,
  contarPorEtapa,
  desenlaceDesdeTags,
  etapaDesdeTags,
  type StageKey,
} from "./etapas";

/** Todo contacto del Pipeline llega con el portón de entrada puesto; se escribe una vez acá. */
const ZONA = TAGS.zonaCloser.valor;

describe("cada tag de desenlace cae en SU etapa", () => {
  it("venta_ganada → ganado", () => {
    expect(etapaDesdeTags([ZONA, TAGS.ventaGanada.valor])).toBe("ganado");
  });

  it("adelanto_ganado → cierre", () => {
    expect(etapaDesdeTags([ZONA, TAGS.adelantoGanado.valor])).toBe("cierre");
  });

  it("seguimiento → seguimiento", () => {
    expect(etapaDesdeTags([ZONA, TAGS.seguimiento.valor])).toBe("seguimiento");
  });

  it("descalificado → descalificado", () => {
    expect(etapaDesdeTags([ZONA, TAGS.descalificado.valor])).toBe("descalificado");
  });

  it("noshow → no_show", () => {
    expect(etapaDesdeTags([ZONA, TAGS.noshow.valor])).toBe("no_show");
  });

  it("nurture_appflow → nurture", () => {
    expect(etapaDesdeTags([ZONA, TAGS.nurtureAppflow.valor])).toBe("nurture");
  });

  it("el desenlace viaja con el tag que lo decidió, para poder explicar la clasificación", () => {
    expect(desenlaceDesdeTags([ZONA, TAGS.noshow.valor])).toEqual({
      resultado: "no_show",
      tag: "noshow",
      etapa: "no_show",
    });
  });
});

describe("tags acumulados — gana la prioridad, no el orden de llegada", () => {
  /**
   * El caso que motiva toda la función: el contrato §4 dice que escribir un resultado nuevo
   * NO borra los anteriores, y GHL devuelve los tags sin fecha. Sin prioridad, la etapa
   * dependería de cómo vino ordenado el array.
   */
  it("el orden del array no cambia el resultado", () => {
    const tags = [ZONA, TAGS.seguimiento.valor, TAGS.ventaGanada.valor];
    expect(etapaDesdeTags(tags)).toBe("ganado");
    expect(etapaDesdeTags([...tags].reverse())).toBe("ganado");
  });

  it("la venta cobrada le gana a todo", () => {
    const todos = [
      ZONA,
      TAGS.seguimiento.valor,
      TAGS.noshow.valor,
      TAGS.nurtureAppflow.valor,
      TAGS.descalificado.valor,
      TAGS.adelantoGanado.valor,
      TAGS.ventaGanada.valor,
    ];
    expect(etapaDesdeTags(todos)).toBe("ganado");
  });

  it("la seña le gana a todo salvo a la venta", () => {
    expect(etapaDesdeTags([ZONA, TAGS.adelantoGanado.valor, TAGS.seguimiento.valor])).toBe("cierre");
    expect(etapaDesdeTags([ZONA, TAGS.adelantoGanado.valor, TAGS.noshow.valor])).toBe("cierre");
    expect(etapaDesdeTags([ZONA, TAGS.adelantoGanado.valor, TAGS.ventaGanada.valor])).toBe("ganado");
  });

  /**
   * La secuencia real más común de todas: se lo persigue durante semanas y termina diciendo
   * que no. `seguimiento` no lo quita nadie (contrato §9: "sirve pre y post call"), así que
   * quedan los dos tags puestos. Si ganara `seguimiento`, un contacto ya descalificado
   * seguiría apareciendo en la columna de trabajo activo del closer.
   */
  it("un descalificado que antes estuvo en seguimiento NO vuelve a la cola activa", () => {
    expect(etapaDesdeTags([ZONA, TAGS.seguimiento.valor, TAGS.descalificado.valor])).toBe("descalificado");
  });

  it("lo mismo para nurture: 'no es ahora' le gana al seguimiento viejo", () => {
    expect(etapaDesdeTags([ZONA, TAGS.seguimiento.valor, TAGS.nurtureAppflow.valor])).toBe("nurture");
  });

  it("un no-show pesa más que el seguimiento arrastrado, y menos que cualquier desenlace decidido", () => {
    expect(etapaDesdeTags([ZONA, TAGS.seguimiento.valor, TAGS.noshow.valor])).toBe("no_show");
    expect(etapaDesdeTags([ZONA, TAGS.noshow.valor, TAGS.descalificado.valor])).toBe("descalificado");
    expect(etapaDesdeTags([ZONA, TAGS.noshow.valor, TAGS.nurtureAppflow.valor])).toBe("nurture");
  });
});

describe("sin tags de desenlace — agendado es la etapa de ENTRADA, no un cajón de sobras", () => {
  it("zona_closer a secas: agendó y todavía no recibió ningún Avanzar", () => {
    expect(etapaDesdeTags([ZONA])).toBe("agendado");
  });

  it("un array vacío tampoco rompe", () => {
    expect(etapaDesdeTags([])).toBe(ETAPA_DE_ENTRADA);
    expect(desenlaceDesdeTags([])).toBeNull();
  });

  it("los tags de contexto que trae todo contacto no clasifican", () => {
    // Ninguno de estos dice en qué terminó una llamada: son origen, cita y barrido.
    expect(etapaDesdeTags([ZONA, TAGS.citaAgendada.valor, "lead_meta_ads", TAGS.estancado.valor])).toBe("agendado");
  });

  /**
   * El swap `zona_setter`→`zona_closer` (WF 04.1) NO quita las series del setter, así que un
   * contacto recién agendado las sigue arrastrando. Si contaran como desenlace, media
   * columna de Agendado aparecería en Seguimiento.
   */
  it("las series del SETTER no arrastran al contacto a Seguimiento", () => {
    expect(etapaDesdeTags([ZONA, TAGS.seguimientoParaAgendar.valor])).toBe("agendado");
    expect(etapaDesdeTags([ZONA, TAGS.seguimientoDecisionLt.valor])).toBe("agendado");
  });

  /**
   * Los tags de MODO dicen CÓMO se persigue, no en qué terminó. El tool nunca escribe uno
   * sin escribir también `seguimiento`, así que verlos solos es dato malformado —y ante un
   * dato que no clasifica, la etapa de entrada, sin inventar (§4.10).
   */
  it("el modo de seguimiento sin el desenlace no clasifica; con él, sí", () => {
    expect(etapaDesdeTags([ZONA, TAGS.seguimientoRecupero.valor])).toBe("agendado");
    expect(etapaDesdeTags([ZONA, TAGS.seguimientoManual.valor])).toBe("agendado");
    expect(etapaDesdeTags([ZONA, TAGS.seguimiento.valor, TAGS.seguimientoRecupero.valor])).toBe("seguimiento");
  });
});

describe("tags desconocidos", () => {
  it("se ignoran en silencio, sin cambiar la etapa", () => {
    expect(etapaDesdeTags(["cualquier_cosa", "tag_de_campaña_2026", ""])).toBe("agendado");
    expect(etapaDesdeTags([ZONA, "vip", TAGS.seguimiento.valor, "black_friday"])).toBe("seguimiento");
  });

  it("no matchea por parecido: un tag que CONTIENE el literal no es el literal", () => {
    // `seguimiento_recupero` contiene "seguimiento"; con un `includes()` en vez de igualdad
    // exacta, cualquier tag nuevo que empezara con el prefijo movería contactos de columna.
    expect(etapaDesdeTags([ZONA, "seguimiento_viejo_2025"])).toBe("agendado");
    expect(etapaDesdeTags([ZONA, "ex_venta_ganada"])).toBe("agendado");
  });

  it("tolera mayúsculas y espacios al leer — clasificar de menos sería peor", () => {
    expect(etapaDesdeTags([ZONA, "  Venta_Ganada "])).toBe("ganado");
  });
});

describe("integridad del catálogo — que agregar una salida no deje un hueco silencioso", () => {
  it("las seis salidas de Avanzar están en la prioridad, sin repetir ni faltar", () => {
    expect([...PRIORIDAD_DESENLACES].sort()).toEqual(Object.keys(RESULTADOS).sort());
  });

  it("todo stage que declara el catálogo es una de las siete etapas", () => {
    for (const def of Object.values(RESULTADOS)) {
      expect(ETAPAS_ORDEN).toContain(def.stage as StageKey);
    }
  });

  /**
   * `closerStore.tsx` no se puede importar desde `api/` (tiene React adentro), así que la
   * unión vive duplicada. Este test es lo que impide que las dos copias se separen.
   */
  it("las siete etapas son exactamente las del front (STAGE_ORDER de closerStore)", () => {
    expect(ETAPAS_ORDEN).toEqual(STAGE_ORDER);
  });
});

describe("contarPorEtapa", () => {
  it("devuelve las siete claves, incluidas las que dan cero — la regla §4.1 la aplica la vista", () => {
    const conteo = contarPorEtapa(["ganado", "seguimiento", "ganado"]);
    expect(Object.keys(conteo)).toEqual([...ETAPAS_ORDEN]);
    expect(conteo.ganado).toBe(2);
    expect(conteo.seguimiento).toBe(1);
    expect(conteo.agendado).toBe(0);
  });

  it("sin contactos, todo en cero y ninguna clave de menos", () => {
    expect(contarPorEtapa([])).toEqual({
      agendado: 0,
      seguimiento: 0,
      cierre: 0,
      ganado: 0,
      no_show: 0,
      nurture: 0,
      descalificado: 0,
    });
  });
});
