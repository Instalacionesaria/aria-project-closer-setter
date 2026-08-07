/**
 * Elige el adapter de Meta. Mismo criterio que `ghl/index.ts`.
 *
 * El default es el **stub**, y el stub no devuelve números inventados: devuelve una lista vacía y
 * `real: false`. Esa es la diferencia con el stub de GHL, que sí simula efectos — acá inventar una
 * cifra de gasto sería exactamente el dato falso que la fase 8 existe para no mostrar.
 *
 * Una empresa sin credenciales de Meta cae al stub y su panel de Acquisition queda vacío diciendo
 * por qué. Es el estado correcto: no es un error, es una integración que nadie configuró todavía.
 */

import { credencialesActivas } from "../credenciales.js";
import { metaReal } from "./real.js";
import type { MetaPort, ResultadoMeta } from "./port.js";

const metaStub: MetaPort = {
  modo: "stub",
  async insights(): Promise<ResultadoMeta> {
    return {
      ok: true,
      metricas: [],
      crudo: null,
      real: false,
      error: undefined,
    };
  },
};

/** ¿La empresa activa tiene con qué hablarle a Meta? */
export function tieneCredencialesMeta(): boolean {
  const cred = credencialesActivas();
  return Boolean(cred?.metaToken && cred?.metaAdAccountId);
}

export function meta(): MetaPort {
  return tieneCredencialesMeta() ? metaReal : metaStub;
}

export type { MetaPort, MetricaMeta, NivelMeta, ResultadoMeta } from "./port.js";
