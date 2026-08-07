/**
 * De qué empresa es un webhook (§6.3).
 *
 * Se prueba `locationIdDe` suelta y no el handler entero: es una función pura sobre el payload,
 * y es la que decide si un evento se procesa o se guarda como huérfano. Equivocarse acá tiene
 * dos formas de doler, y las dos son caras — leer de menos corta la ingesta de una empresa, y
 * leer de más manda los eventos de un cliente a los datos de otro.
 *
 * Los payloads de abajo NO están inventados: son la forma de las 84 filas reales de
 * `closer_webhook_inbox` de producción, contadas el 2026-08-07.
 */

import { describe, expect, it } from "vitest";
import { locationIdDe } from "./ruteoWebhook.js";

const LOCATION = "DbWG5cimcumPcKk5p3xC";

describe("locationIdDe · de qué subcuenta viene el evento", () => {
  describe("las tres formas que llegan de verdad", () => {
    /** 80 de los 81 eventos de GHL en producción. Ninguno trae el id arriba. */
    it("GHL lo manda anidado en location.id", () => {
      expect(locationIdDe({ location: { id: LOCATION }, contact_id: "abc" })).toBe(LOCATION);
    });

    /** Los 3 de Assistable. */
    it("Assistable lo manda como location_id", () => {
      expect(locationIdDe({ location_id: LOCATION, call_id: "x" })).toBe(LOCATION);
    });

    it("acepta locationId por si GHL vuelve a cambiar el payload", () => {
      expect(locationIdDe({ locationId: LOCATION })).toBe(LOCATION);
    });
  });

  describe("lo que NO tiene que devolver", () => {
    /**
     * El error que cometí en la primera versión: un fallback a `contact.id`. Es el id de la
     * persona, no el de la subcuenta. Hoy no encontraría ninguna empresa; el problema es el día
     * que encuentre la equivocada.
     */
    it("NO usa contact.id como id de subcuenta", () => {
      expect(locationIdDe({ contact: { id: "un-contacto-cualquiera" } })).toBeNull();
    });

    it("el evento de prueba sin location queda sin atribuir", () => {
      // La única fila real sin location: una prueba por curl, con el contacto en ceros.
      expect(locationIdDe({ calendar: { id: "test-apt" }, contact_id: "000000000000000000000000" })).toBeNull();
    });

    it("un cuerpo vacío o nulo no atribuye nada", () => {
      expect(locationIdDe(null)).toBeNull();
      expect(locationIdDe({})).toBeNull();
    });

    /**
     * Un string vacío no es un id: sin esto, `.eq("ghl_location_id", "")` podría llegar a
     * empatar con una empresa mal cargada. Se normaliza a null, que corta antes de consultar.
     */
    it("un location vacío o en blanco es null, no cadena vacía", () => {
      expect(locationIdDe({ locationId: "" })).toBeNull();
      expect(locationIdDe({ location_id: "   " })).toBeNull();
      expect(locationIdDe({ location: { id: null } })).toBeNull();
    });
  });

  describe("precedencia", () => {
    it("el de arriba gana sobre el anidado", () => {
      expect(locationIdDe({ locationId: "arriba", location: { id: "anidado" } })).toBe("arriba");
    });

    /** Se recorta: un id con espacios alrededor no debe fallar la búsqueda por igualdad. */
    it("recorta los espacios", () => {
      expect(locationIdDe({ locationId: `  ${LOCATION}  ` })).toBe(LOCATION);
    });
  });
});
