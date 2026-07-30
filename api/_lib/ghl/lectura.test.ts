/**
 * `perfilDesdeContacto` — la traducción de un contacto de GHL a los campos del tab Perfil.
 *
 * Lo que se prueba acá no es "el mapeo funciona", sino los tres modos de falla que costarían
 * caro en producción y que no se ven compilando: un campo inventado con un placeholder, un
 * campo real que no se encuentra por el prefijo `contact.`, y la mezcla de los formularios
 * VSL y Meta —que el contrato pide explícitamente NO unificar (§4)— en un solo bloque.
 */

import { describe, expect, it } from "vitest";
import { perfilDesdeContacto } from "./lectura.js";
import type { ContactoGhl } from "./port.js";

const contacto = (parcial: Partial<ContactoGhl> = {}): ContactoGhl => ({
  id: "c1",
  nombre: "Prueba",
  tags: [],
  customFields: {},
  ...parcial,
});

const valorDe = (campos: ReturnType<typeof perfilDesdeContacto>, label: string) =>
  campos.find((c) => c.label === label)?.value;

describe("regla §4.10 — sin dato real, el campo no viaja", () => {
  it("un contacto sin nada devuelve una lista vacía, no etiquetas huérfanas", () => {
    expect(perfilDesdeContacto(contacto())).toEqual([]);
  });

  it("un custom field vacío o en blanco no se incluye", () => {
    const campos = perfilDesdeContacto(
      contacto({
        customFields: {
          "contact.tiene_equipo_": "",
          "contact._video_precall": "   ",
          "contact._llamadas_ia_intentos": "3",
        },
      }),
    );

    expect(campos.map((c) => c.label)).toEqual(["Llamadas IA · intentos"]);
  });

  it("teléfono y correo salen solo si existen — nunca un guion de relleno", () => {
    expect(perfilDesdeContacto(contacto({ telefono: "+54 911 2233 4455" })).map((c) => c.label)).toEqual([
      "Teléfono",
    ]);
    expect(perfilDesdeContacto(contacto({ telefono: "  ", email: "" }))).toEqual([]);
  });

  /**
   * `derivarFuente` cae a "DIRECTO" cuando ningún tag identifica el origen. Como chip de fila
   * está bien (§8: ninguna fila sin origen), pero como campo del Perfil afirmaría que el lead
   * entró de forma directa cuando en realidad no sabemos de dónde vino.
   */
  it("la fuente sale si los tags la identifican, y se omite si cae al fallback DIRECTO", () => {
    expect(valorDe(perfilDesdeContacto(contacto({ tags: ["lead_meta_ads"] })), "Fuente")).toBe("META ADS");
    expect(valorDe(perfilDesdeContacto(contacto({ tags: ["zona_closer"] })), "Fuente")).toBeUndefined();
  });
});

describe("la unique key se encuentra con o sin el prefijo `contact.`", () => {
  /**
   * GHL devuelve la key de las dos formas según por dónde entre el dato. Comparar los strings
   * crudos haría que la mitad de los campos "no existan" y el Perfil saliera vacío sin que
   * nada fallara — el mismo fallo silencioso de escribir el custom field por `key` (§50.5).
   */
  it("sin prefijo", () => {
    const campos = perfilDesdeContacto(contacto({ customFields: { tiene_equipo_: "Sí, 2 personas" } }));
    expect(valorDe(campos, "Tiene equipo")).toBe("Sí, 2 personas");
  });

  it("con prefijo", () => {
    const campos = perfilDesdeContacto(contacto({ customFields: { "contact.tiene_equipo_": "No" } }));
    expect(valorDe(campos, "Tiene equipo")).toBe("No");
  });

  it("y con la caja cambiada, que también varía entre respuestas", () => {
    const campos = perfilDesdeContacto(contacto({ customFields: { "Contact.Tiene_Equipo_": "No" } }));
    expect(valorDe(campos, "Tiene equipo")).toBe("No");
  });
});

describe("Calificación — VSL y Meta son campos distintos, no uno solo", () => {
  const ambos = perfilDesdeContacto(
    contacto({
      customFields: {
        "contact._en_qu_etapa_est_tu_negocio_hoy": "Facturando, quiere escalar",
        "contact.en_que_etapa_esta_tu_negocio_hoy": "Recién empiezo",
      },
    }),
  );

  it("la misma pregunta en los dos formularios produce DOS campos, cada uno con su bloque", () => {
    const etapas = ambos.filter((c) => c.label === "Etapa del negocio");
    expect(etapas).toHaveLength(2);
    expect(etapas.map((c) => c.formulario).sort()).toEqual(["meta", "vsl"]);
    expect(etapas.every((c) => c.group === "calificacion")).toBe(true);
  });

  it("el valor de cada formulario no se pisa con el del otro", () => {
    expect(ambos.find((c) => c.formulario === "vsl")?.value).toBe("Facturando, quiere escalar");
    expect(ambos.find((c) => c.formulario === "meta")?.value).toBe("Recién empiezo");
  });

  it("un lead que solo llenó Meta no produce ningún campo de VSL", () => {
    const soloMeta = perfilDesdeContacto(
      contacto({ customFields: { "contact.cual_es_tu_objetivo_de_facturacion": "$10.000" } }),
    );
    expect(soloMeta.every((c) => c.formulario !== "vsl")).toBe(true);
  });
});

describe("grupos y procedencia", () => {
  it("los campos caen en el grupo que les corresponde en la ficha", () => {
    const campos = perfilDesdeContacto(
      contacto({
        telefono: "+54 911 0000 0000",
        tags: ["lead_meta_ads"],
        customFields: {
          "contact._podras_asumir_una_inversin_de_4000_a_8000_usd": "Sí",
          "contact.ultima_llamada_ia__resultado": "Contestó · confirmó",
        },
      }),
    );

    expect(valorDe(campos, "Teléfono") && campos.find((c) => c.label === "Teléfono")?.group).toBe("detalles");
    expect(campos.find((c) => c.label === "Fuente")?.group).toBe("origen");
    expect(campos.find((c) => c.label === "Inversión $4-8k")?.group).toBe("calificacion");
    expect(campos.find((c) => c.label === "Última llamada IA · resultado")?.group).toBe("interacciones");
  });

  it('"Tiene equipo" lo llena el agente de voz, y el campo lo dice', () => {
    const campos = perfilDesdeContacto(contacto({ customFields: { "contact.tiene_equipo_": "Sí" } }));
    expect(campos[0].procedencia).toBe("vía llamada IA");
  });

  it("los campos sin procedencia no la llevan puesta en undefined", () => {
    const campos = perfilDesdeContacto(contacto({ customFields: { "contact._video_precall": "87" } }));
    expect("procedencia" in campos[0]).toBe(false);
    expect("formulario" in campos[0]).toBe(false);
  });
});

describe("valores que GHL no manda como string", () => {
  /**
   * El tipo dice `Record<string, string>`, pero GHL manda números en los campos numéricos y
   * arrays en los de selección múltiple. Un `.trim()` sobre un número revienta en runtime, en
   * medio de una lectura que debería ser inofensiva.
   */
  it("un número se lee como texto en vez de romper la respuesta", () => {
    const campos = perfilDesdeContacto(
      contacto({ customFields: { "contact._llamadas_ia_intentos": 3 as unknown as string } }),
    );
    expect(valorDe(campos, "Llamadas IA · intentos")).toBe("3");
  });

  it("una selección múltiple se une con comas", () => {
    const campos = perfilDesdeContacto(
      contacto({
        customFields: {
          "contact._qu_tipo_de_servicios_ofreces_o_planeas_ofrecer": ["Ads", "Contenido"] as unknown as string,
        },
      }),
    );
    expect(valorDe(campos, "Tipo de servicios")).toBe("Ads, Contenido");
  });
});
