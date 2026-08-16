import { describe, it, expect } from "vitest";
import {
  TAGS,
  TAGS_BOT,
  TAG_SEGUIMIENTO_AUTO,
  CAMPOS,
  SITUACIONES,
  TAGS_SEGUIMIENTO_EXCLUYENTES,
  CAMPO_SUBCATEGORIA_POR_STAGE,
  STAGE_GHL_A_FRONT,
  situacionDesdeGhl,
  situacionPorSlug,
  perteneceAlCloser,
  estadoBotDesdeTags,
  botDesdeTags,
  botAtendiendo,
  tieneFalloDeAuditor,
  FUENTE_IG,
  assertEnviable,
  literalesPendientes,
  LiteralNoConfirmadoError,
} from "./contrato";
import { armarPildora } from "../pildora";

describe("assertEnviable — un literal inventado no puede llegar a GHL", () => {
  it("en modo stub deja pasar todo, para poder ejercitar la lógica completa", () => {
    expect(() =>
      assertEnviable(TAGS.seguimientoTerminado, false),
    ).not.toThrow();
  });

  it("en modo real lanza ante un literal pendiente de confirmar", () => {
    expect(() => assertEnviable(TAGS.seguimientoTerminado, true)).toThrow(
      LiteralNoConfirmadoError,
    );
  });

  it("en modo real deja pasar los confirmados", () => {
    expect(() => assertEnviable(TAGS.seguimientoRecupero, true)).not.toThrow();
    expect(() => assertEnviable(TAGS.seguimientoManual, true)).not.toThrow();
    expect(() => assertEnviable(TAGS.ventaGanada, true)).not.toThrow();
    expect(() =>
      assertEnviable(CAMPOS.nivelInteresSeguimiento, true),
    ).not.toThrow();
  });

  it("el error dice qué falta y a quién pedírselo", () => {
    expect(() => assertEnviable(TAGS.seguimientoTerminado, true)).toThrow(
      /seguimiento_terminado/,
    );
    expect(() => assertEnviable(TAGS.seguimientoTerminado, true)).toThrow(
      /Fabio/,
    );
  });
});

describe("literales del contrato", () => {
  /**
   * Verificado contra la subcuenta DbWG5cimcumPcKk5p3xC el 2026-07-25: los tags que este módulo
   * escribe o lee EXISTEN.
   *
   * Los pendientes son de **dos clases distintas**, y la lista se fija entera a propósito: si
   * mañana aparece un cuarto pendiente sin que nadie lo haya decidido, este test lo caza.
   *
   *   1. `seguimiento_terminado` — lo ENCONTRAMOS en la cuenta y no está en el contrato, así que
   *      no sabemos qué lo dispara. Pendiente por desconocimiento.
   *   2. Los tres `setter_*` — los PROPUSIMOS nosotros el 2026-08-08 para las etapas de
   *      calificación del pipeline del setter, que no tenían representación en GHL. Pendientes
   *      hasta que existan en GHL. Ver `etapasSetter.ts`.
   *
   * Las otras cuatro etapas del setter NO están acá porque reusan tags confirmados: sería un
   * error crear duplicados de `derivado_lt`, `nurture_appflow` y
   * `descalificado`, y `agendado` lo resuelve el swap de territorio.
   */
  it("los pendientes son exactamente los que sabemos que faltan", () => {
    expect(literalesPendientes().map((l) => l.valor)).toEqual([
      "seguimiento_terminado",
      "setter_nuevo",
      "setter_en_calificacion",
      "setter_calificado",
    ]);
  });

  /**
   * El portón que hace que un literal pendiente sea inofensivo: no sale a GHL en modo real.
   *
   * Es lo que permite que las siete columnas del pipeline funcionen desde el día uno con tres
   * tags que todavía no existen — la etapa se guarda en Supabase, que es la fuente de verdad, y
   * el tag se manda recién cuando exista en GHL.
   */
  it("los tags propuestos del setter no salen a GHL hasta que existan", () => {
    for (const tag of [
      TAGS.setterNuevo,
      TAGS.setterEnCalificacion,
      TAGS.setterCalificado,
    ]) {
      expect(() => assertEnviable(tag, true)).toThrow();
      // En modo stub sí pasan: ahí no hay cuenta real que pueda rechazarlos.
      expect(() => assertEnviable(tag, false)).not.toThrow();
    }
  });

  it("el tag de modo manual existe en la cuenta — verificado, no supuesto", () => {
    expect(TAGS.seguimientoManual.confianza).toBe("confirmado");
    expect(TAGS.seguimientoManual.fuente).toMatch(/Verificado en la subcuenta/);
  });

  it("el tag de la serie del closer es seguimiento_recupero — seguimiento_activo fue ELIMINADO", () => {
    // CONTRATO-GHL.md §9: "`seguimiento_activo`: ELIMINADO (se decidió trabajar con los
    // tags detallados directamente)". CLAUDE.md §8 todavía lo declara como fuente del ⏱;
    // esa línea queda corregida en la sección nueva.
    expect(TAGS.seguimientoRecupero.valor).toBe("seguimiento_recupero");
    const todos = Object.values(TAGS).map((t) => t.valor);
    expect(todos).not.toContain("seguimiento_activo");
  });

  it("los custom fields conservan los typos reales de GHL — son unique keys, no prosa", () => {
    // "inters" y "razn" están así en la subcuenta. Corregirlos rompe la escritura.
    expect(CAMPOS.nivelInteresSeguimiento.valor).toBe(
      "contact.nivel_de_inters_seguimiento",
    );
    expect(CAMPOS.razonNoshow.valor).toBe("contact.razn_de_noshow");
    expect(CAMPOS.motivoDescalificacion.valor).toBe(
      "contact.motivo_de_descalificacin",
    );
  });

  it("los tags de seguimiento son mutuamente excluyentes y están todos listados", () => {
    expect(TAGS_SEGUIMIENTO_EXCLUYENTES).toHaveLength(4);
    expect(TAGS_SEGUIMIENTO_EXCLUYENTES).toContain("seguimientoRecupero");
    expect(TAGS_SEGUIMIENTO_EXCLUYENTES).toContain("seguimientoManual");
  });
});

describe("zona_closer — el portón de entrada al módulo del closer", () => {
  it("es el tag que GHL aplica al agendar (WF 04.1), no uno llamado `closer`", () => {
    // El prompt original pedía filtrar por un tag `closer`. Ese tag no existe en la
    // subcuenta; el real es `zona_closer`. Verificado contra CONTRATO-GHL.md §3 y §9.
    expect(TAGS.zonaCloser.valor).toBe("zona_closer");
    expect(Object.values(TAGS).map((t) => t.valor)).not.toContain("closer");
  });

  it("deja entrar a quien lo tiene y bloquea a quien no", () => {
    expect(perteneceAlCloser(["zona_closer", "cita_agendada"], true)).toBe(
      true,
    );
    expect(perteneceAlCloser(["zona_setter"], true)).toBe(false);
    expect(perteneceAlCloser([], true)).toBe(false);
  });

  /**
   * `cita_agendada` se quita al cerrar o cancelar la cita (§9). Filtrar por ahí sacaría al
   * contacto de las vistas del closer justo al terminar la llamada — que es cuando queda
   * todo el trabajo por hacer.
   */
  it("un contacto post-call, ya sin cita viva, sigue perteneciendo al closer", () => {
    expect(perteneceAlCloser(["zona_closer"], true)).toBe(true);
  });

  it("apagado por defecto: la semilla del demo no tiene tags y el filtro la vaciaría", () => {
    expect(perteneceAlCloser([])).toBe(true);
  });
});

describe("situaciones del seguimiento", () => {
  /**
   * Los labels no son texto de UI: son los valores literales del dropdown
   * `contact.nivel_de_inters_seguimiento` (campo iZN1zfDlTOrPvjssFjrX, SINGLE_OPTIONS).
   * Verificados uno por uno contra la subcuenta el 2026-07-25. Si alguno cambia acá y no
   * en GHL, la escritura del campo falla en silencio.
   */
  it("los cinco labels son exactamente las opciones del dropdown en la cuenta", () => {
    expect(SITUACIONES.map((s) => s.label)).toEqual([
      "Próximo a pagar",
      "Muy interesado",
      "Dudando",
      "Enfriándose",
      "Otro",
    ]);
  });

  it('"Otro" ya está en el dropdown — la pantalla de §39.1 queda cubierta', () => {
    expect(situacionPorSlug("otro").confianza).toBe("confirmado");
  });

  it("lee el valor que devuelve GHL, tolerando espacios y mayúsculas", () => {
    expect(situacionDesdeGhl("Muy interesado")).toBe("muy_interesado");
    expect(situacionDesdeGhl("  próximo a pagar  ")).toBe("proximo_a_pagar");
    expect(situacionDesdeGhl("Enfriándose")).toBe("enfriandose");
  });

  it("un valor desconocido o vacío no se adivina — devuelve undefined (§4.10)", () => {
    expect(situacionDesdeGhl("Tibio")).toBeUndefined();
    expect(situacionDesdeGhl("")).toBeUndefined();
    expect(situacionDesdeGhl(null)).toBeUndefined();
  });
});

describe("mapa de stages y regla de acumulación (§4 del contrato)", () => {
  it("cada stage con subcategoría apunta a SU campo, no a otro", () => {
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.seguimiento).toBe(
      "nivelInteresSeguimiento",
    );
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.ganado).toBe("formaPagoVenta");
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.no_show).toBe("razonNoshow");
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.nurture).toBe("origenNurture");
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.descalificado).toBe(
      "motivoDescalificacion",
    );
  });

  it("agendado y cierre no tienen campo de subcategoría", () => {
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.agendado).toBeUndefined();
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.cierre).toBeUndefined();
  });

  it('los stages de GHL "Cierre en curso" y "Adelanto" caen en el mismo `cierre` del front', () => {
    expect(STAGE_GHL_A_FRONT["Cierre en curso"]).toBe("cierre");
    expect(STAGE_GHL_A_FRONT["Adelanto"]).toBe("cierre");
  });
});

describe("armarPildora — CATEGORÍA · SUBCATEGORÍA en mayúsculas (§12/§39.3)", () => {
  it("un seguimiento siempre lleva la situación, nunca la fecha", () => {
    expect(
      armarPildora({ stage: "seguimiento", subcategoria: "Muy interesado" }),
    ).toBe("SEGUIMIENTO · MUY INTERESADO");
    expect(
      armarPildora({ stage: "seguimiento", subcategoria: "Dudando" }),
    ).toBe("SEGUIMIENTO · DUDANDO");
  });

  it("no se inventa subcategoría cuando GHL no tiene el dato (§4.10)", () => {
    expect(armarPildora({ stage: "seguimiento" })).toBe("SEGUIMIENTO");
    expect(armarPildora({ stage: "seguimiento", subcategoria: "  " })).toBe(
      "SEGUIMIENTO",
    );
    expect(armarPildora({ stage: "nurture", subcategoria: null })).toBe(
      "NURTURE",
    );
  });

  it("una venta lleva TRES campos: categoría, forma de pago y monto", () => {
    // El caso que reportó Fabio: la píldora salía sin la forma de pago aunque el modal
    // la exigía para poder confirmar. La subcategoría de `ganado` es `formaPagoVenta`, tal
    // como lo declara CAMPO_SUBCATEGORIA_POR_STAGE en contrato.ts.
    expect(
      armarPildora({ stage: "ganado", subcategoria: "Contado", monto: 100 }),
    ).toBe("VENTA · CONTADO · $100");
    expect(
      armarPildora({
        stage: "ganado",
        subcategoria: "Buy Now Pay Later",
        monto: 5400,
      }),
    ).toBe("VENTA · BUY NOW PAY LATER · $5.400");
  });

  it("una venta con datos parciales muestra lo que hay, sin inventar (§4.10)", () => {
    // Un contacto traído de GHL puede tener uno de los dos campos y no el otro. Ninguna de
    // las dos ausencias debe romper la píldora ni rellenarse con un valor por defecto.
    expect(armarPildora({ stage: "ganado", monto: 5000 })).toBe(
      "VENTA · $5.000",
    );
    expect(armarPildora({ stage: "ganado", subcategoria: "Cuotas" })).toBe(
      "VENTA · CUOTAS",
    );
    expect(armarPildora({ stage: "ganado" })).toBe("VENTA");
  });

  it("en un acuerdo la plata sigue siendo la subcategoría — todavía no hay forma de pago", () => {
    // `cierre` es una promesa de pago, no un pago: no hay forma de pago que registrar.
    expect(armarPildora({ stage: "cierre", monto: 500 })).toBe(
      "ACORDÓ COMPRAR · $500",
    );
  });

  it("reproduce exactamente lo que Avanzar produce hoy", () => {
    expect(armarPildora({ stage: "no_show", subcategoria: "Plantón" })).toBe(
      "NO-SHOW · PLANTÓN",
    );
    expect(armarPildora({ stage: "nurture", subcategoria: "Se enfrió" })).toBe(
      "NURTURE · SE ENFRIÓ",
    );
  });
});

describe("estadoBotDesdeTags — el ruteo del Buzón depende de esto (doc §2)", () => {
  it("sin ningún tag de bot → APAGADO (default conservador: el mensaje entra al Buzón)", () => {
    expect(estadoBotDesdeTags([])).toBe("apagado");
    expect(estadoBotDesdeTags(["zona_closer", "seguimiento"])).toBe("apagado");
  });

  it("bot_activado → PRENDIDO (sus mensajes NO van al Buzón, quedan para el auditor)", () => {
    expect(estadoBotDesdeTags(["zona_closer", "bot_activado"])).toBe(
      "prendido",
    );
  });

  /**
   * La regla del Buzón, con los tags por agente (2026-08-16).
   *
   * El Buzón General es la cola de "nadie le está respondiendo": son los contactos que un humano
   * tiene que atender a mano. Un contacto cuyo bot está atendiendo NO va ahí — sus mensajes son
   * trabajo del agente, y aparecen para el auditor, no para el closer.
   *
   * Con un solo `bot_activado` esto era una pregunta; con los tags por agente sigue siendo la
   * misma: da igual CUÁL de los dos atiende, si hay uno atendiendo el mensaje no es del humano.
   * Si `botDesdeTags` no reconociera los nuevos, los 42 contactos con `bot_activado_appflow`
   * caerían todos al Buzón el día que GHL empiece a aplicarlos — una cola inflada con gente que
   * ya está siendo atendida.
   */
  it("los tags por agente también sacan al contacto del Buzón", () => {
    expect(estadoBotDesdeTags(["zona_closer", "bot_activado_appflow"])).toBe(
      "prendido",
    );
    expect(estadoBotDesdeTags(["zona_setter", "bot_activado_leadflow"])).toBe(
      "prendido",
    );
  });

  /**
   * Y al revés: el tag que el auditor aplica al encontrar un fallo devuelve al contacto al
   * circuito humano. Es lo que tiene que pasar — el bot quedó pausado y alguien debe responder.
   */
  it("y el desactivado por el auditor lo devuelve a apagado", () => {
    expect(
      estadoBotDesdeTags(["bot_activado_appflow", "bot_desactivado_appflow"]),
    ).toBe("apagado");
    expect(
      estadoBotDesdeTags(["bot_activado_leadflow", "bot_desactivado_leadflow"]),
    ).toBe("apagado");
  });

  /**
   * El cruce: el fallo de UN agente no puede sacar del circuito del bot al otro. Un contacto que
   * tuviera los dos activos y solo uno desactivado sigue teniendo un bot atendiendo... pero el
   * estado del contacto es uno solo y los apagados ganan, así que cae en apagado. Se deja escrito
   * porque es la consecuencia menos obvia del cambio: un fallo del leadflow manda al Buzón un
   * contacto cuyo appflow sigue activo, y eso es deliberado — hay una intervención abierta.
   */
  it("un desactivado gana aunque el otro agente siga activo (intervención abierta)", () => {
    expect(
      estadoBotDesdeTags(["bot_activado_appflow", "bot_desactivado_leadflow"]),
    ).toBe("apagado");
  });

  it("los tags de apagado GANAN sobre bot_activado residual — el orden del doc importa", () => {
    expect(
      estadoBotDesdeTags(["bot_activado", "bot_desactivado_postcall"]),
    ).toBe("apagado");
    expect(estadoBotDesdeTags(["bot_activado", "bot_pausado_fallo"])).toBe(
      "apagado",
    );
  });

  it("normaliza mayúsculas y espacios — GHL no garantiza higiene de tags", () => {
    expect(estadoBotDesdeTags([" Bot_Activado "])).toBe("prendido");
  });

  it("un no-show tiene el bot prendido (workflow de recuperación) → no rutea a Buzón", () => {
    expect(estadoBotDesdeTags(["zona_closer", "noshow", "bot_activado"])).toBe(
      "prendido",
    );
  });

  it("TAG_SEGUIMIENTO_AUTO apunta a seguimiento_recupero hasta que Fabio confirme", () => {
    expect(TAG_SEGUIMIENTO_AUTO).toBe(TAGS.seguimientoRecupero.valor);
  });

  /**
   * Eran cuatro hasta el 2026-08-04, seis hasta el 2026-08-16 y diez desde que los tags del bot
   * son POR AGENTE: GHL necesita saber cuál de los dos chatbots pausar, y un tag único los
   * pausaría a los dos o a ninguno.
   *
   * `bot_activado` y `bot_pausado_fallo` siguen en la lista **como legado de solo lectura**: al
   * hacer el cambio había contactos en GHL con ellos puestos, y dejar de reconocerlos los habría
   * sacado de Urgentes en silencio con la alerta sin resolver.
   */
  it("los diez tags de bot están declarados y confirmados", () => {
    expect(
      Object.values(TAGS_BOT)
        .map((t) => t.valor)
        .sort(),
    ).toEqual([
      "bot_activado",
      "bot_activado_appflow",
      "bot_activado_leadflow",
      "bot_apagado_manual",
      "bot_desactivado_appflow",
      "bot_desactivado_leadflow",
      "bot_desactivado_postcall",
      "bot_pausado_fallo",
      "bot_reactivar",
      "derivado_lt",
    ]);
  });

  /**
   * El parecido peligroso: `bot_desactivado_postcall` empieza igual que los dos nuevos y NO es un
   * fallo — significa "ya tuvo su sales call" y lo aplican las salidas de Avanzar. Si alguna vez
   * alguien compara por prefijo en vez de por igualdad, un contacto que terminó bien su ciclo
   * aparecería en Urgentes.
   */
  it("bot_desactivado_postcall NO cuenta como fallo del auditor", () => {
    expect(tieneFalloDeAuditor(["bot_desactivado_postcall"])).toBe(false);
    expect(botDesdeTags(["bot_desactivado_postcall"])).toBe("muerto_postcall");
  });

  it("los tres tags de fallo sí, y los tres dan el mismo estado", () => {
    for (const tag of [
      "bot_desactivado_appflow",
      "bot_desactivado_leadflow",
      "bot_pausado_fallo",
    ]) {
      expect(tieneFalloDeAuditor([tag])).toBe(true);
      expect(botDesdeTags([tag])).toBe("pausado_fallo");
    }
  });

  /**
   * El portón del auditor con territorio: "hay un bot atendiendo" dejó de ser lo mismo que "el
   * bot QUE VOY A AUDITAR está atendiendo". Un contacto en zona_closer con el tag del leadflow
   * —posible en pleno swap al agendar— tiene bot activo, pero no el que el auditor del closer va
   * a juzgar. Auditarlo ahí es el bug que el portón existe para evitar.
   */
  it("botAtendiendo con territorio pregunta por ESE agente", () => {
    expect(botAtendiendo(["bot_activado_appflow"], "closer")).toBe(true);
    expect(botAtendiendo(["bot_activado_appflow"], "setter")).toBe(false);
    expect(botAtendiendo(["bot_activado_leadflow"], "setter")).toBe(true);
    expect(botAtendiendo(["bot_activado_leadflow"], "closer")).toBe(false);
  });

  it("sin territorio sigue siendo la pregunta vieja: ¿hay ALGÚN bot?", () => {
    expect(botAtendiendo(["bot_activado_leadflow"])).toBe(true);
    expect(botAtendiendo(["bot_activado_appflow"])).toBe(true);
  });

  /** El legado no dice cuál agente atiende, así que sirve para los dos mientras exista. */
  it("el bot_activado legado vale para cualquier territorio", () => {
    expect(botAtendiendo(["bot_activado"], "closer")).toBe(true);
    expect(botAtendiendo(["bot_activado"], "setter")).toBe(true);
  });

  /** Un apagado gana sobre cualquier activado, con territorio o sin él. */
  it("un tag de apagado gana aunque el del agente diga que atiende", () => {
    expect(
      botAtendiendo(
        ["bot_activado_appflow", "bot_desactivado_appflow"],
        "closer",
      ),
    ).toBe(false);
    expect(
      botAtendiendo(["bot_activado_appflow", "bot_apagado_manual"], "closer"),
    ).toBe(false);
  });
});

/**
 * `botDesdeTags` es la única derivación del estado del bot del proyecto, y `estadoBotDesdeTags`
 * es su proyección binaria. Los casos de arriba cubren el binario; estos, los 6 valores.
 */
describe("botDesdeTags — los 6 estados del toggle 🤖", () => {
  it("sin tags → null, nunca 'activo' (default APAGADO, §51.3)", () => {
    expect(botDesdeTags([])).toBeNull();
    expect(botDesdeTags(["zona_closer", "lead_meta_ads"])).toBeNull();
  });

  it("cada tag da su estado", () => {
    expect(botDesdeTags([TAGS_BOT.botActivado.valor])).toBe("activo");
    expect(botDesdeTags([TAGS_BOT.botPausadoFallo.valor])).toBe(
      "pausado_fallo",
    );
    expect(botDesdeTags([TAGS_BOT.botDesactivadoPostcall.valor])).toBe(
      "muerto_postcall",
    );
    expect(botDesdeTags([TAGS_BOT.botApagadoManual.valor])).toBe(
      "apagado_manual",
    );
    expect(botDesdeTags([TAGS_BOT.derivadoLt.valor])).toBe("derivado_lt");
  });

  it("normaliza mayúsculas y espacios, igual que la proyección binaria", () => {
    expect(botDesdeTags([" Bot_Pausado_Fallo "])).toBe("pausado_fallo");
  });

  /**
   * El fallo del auditor gana sobre todo lo demás porque es lo único que pide una acción
   * humana ahora. Si ganara `muerto_postcall`, una urgencia real se vería como un bot que
   * simplemente terminó su ciclo.
   */
  it("el orden de precedencia: fallo > postcall > lt > manual > activado", () => {
    const todos = [
      TAGS_BOT.botActivado.valor,
      TAGS_BOT.botApagadoManual.valor,
      TAGS_BOT.derivadoLt.valor,
      TAGS_BOT.botDesactivadoPostcall.valor,
      TAGS_BOT.botPausadoFallo.valor,
    ];
    expect(botDesdeTags(todos)).toBe("pausado_fallo");
    expect(botDesdeTags(todos.slice(0, 4))).toBe("muerto_postcall");
    expect(botDesdeTags(todos.slice(0, 3))).toBe("derivado_lt");
    expect(botDesdeTags(todos.slice(0, 2))).toBe("apagado_manual");
  });

  it("Instagram no tiene bot, sin importar los tags (§11)", () => {
    expect(botDesdeTags([TAGS_BOT.botActivado.valor], FUENTE_IG)).toBeNull();
    expect(
      botDesdeTags([TAGS_BOT.botPausadoFallo.valor], FUENTE_IG),
    ).toBeNull();
  });

  /**
   * La garantía de que las dos funciones no pueden divergir: `estadoBotDesdeTags` es una
   * proyección, no una segunda implementación. Este test lo verifica sobre todos los casos.
   */
  it("estadoBotDesdeTags es exactamente 'activo → prendido, todo lo demás → apagado'", () => {
    const casos = [
      [],
      [TAGS_BOT.botActivado.valor],
      [TAGS_BOT.botPausadoFallo.valor],
      [TAGS_BOT.botDesactivadoPostcall.valor],
      [TAGS_BOT.botApagadoManual.valor],
      [TAGS_BOT.derivadoLt.valor],
      [TAGS_BOT.botActivado.valor, TAGS_BOT.botPausadoFallo.valor],
    ];
    for (const tags of casos) {
      const esperado = botDesdeTags(tags) === "activo" ? "prendido" : "apagado";
      expect(estadoBotDesdeTags(tags)).toBe(esperado);
    }
  });
});
