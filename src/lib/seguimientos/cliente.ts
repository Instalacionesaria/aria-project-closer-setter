/**
 * Cliente HTTP de la sección Seguimientos.
 *
 * No hay variable de entorno ni flag: la ruta es siempre `/api`, que es donde Vercel sirve
 * las funciones de este mismo repo. Una variable para configurar una constante era una
 * forma más de equivocarse (escribir mal el nombre, olvidarla en un entorno) a cambio de
 * nada.
 *
 * El "modo demo" sale gratis del manejo de errores: en `npm run dev` no hay funciones, la
 * petición falla, y la app sigue con la semilla. Lo mismo si el backend se cae en
 * producción. Todo error devuelve `null` a propósito — esta app no tiene error boundary ni
 * estados de error en ninguna vista, así que dejar la pantalla en blanco sería peor que el
 * demo que funciona. Se avisa por consola y se sigue.
 */

import type { ClosurerContact } from "../closerStore";
import { situacionPorSlug, type SituacionSeguimiento } from "../ghl/contrato";
import { armarPildora } from "../pildora";
import type { EstadoSeguimiento, ModoSeguimiento } from "./dominio";

/** Donde Vercel sirve las funciones de `api/`, en el mismo dominio. */
const BASE_API = "/api";

interface FilaApi {
  ghlContactId: string;
  nombre: string | null;
  telefono: string | null;
  tags: string[];
  fijada: boolean;
  diasVencido: number;
  seguimiento: {
    id: string;
    situacion: SituacionSeguimiento;
    modo: ModoSeguimiento;
    fechaObjetivo: string;
    estado: EstadoSeguimiento;
    nota?: string;
    serie?: { key: string; toques: number; dias: number };
  };
  fila: { microtext: string; tono: "neutral" | "vencido" | "agotado"; vencido: boolean };
}

export interface RespuestaMiDia {
  ok: boolean;
  hoy: string;
  zonaHoraria: string;
  ghlModo: "real" | "stub";
  seguimientosHoy: FilaApi[];
  total: number;
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(`${BASE_API}${ruta}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    // En `npm run dev` no hay funciones y Vite devuelve el index.html del SPA: el parseo
    // falla y caemos al `catch`. Es el modo demo, sin configurar nada.
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok || !cuerpo) {
      console.warn(`[seguimientos] ${ruta} devolvió ${r.status}`, cuerpo);
      return null;
    }
    return cuerpo as T;
  } catch {
    // Silencioso a propósito: sin backend esto pasa en cada carga, y llenar la consola de
    // rojo en la demo confundiría más de lo que ayuda.
    return null;
  }
}

export const traerMiDia = () => pedir<RespuestaMiDia>("/closer/mi-dia");

export interface AvanzarSeguimientoBody {
  ghlContactId: string;
  situacion: SituacionSeguimiento;
  modo: ModoSeguimiento;
  preset?: string;
  fechaPersonalizada?: string;
  nota?: string;
  idempotencyKey: string;
}

export interface RespuestaAvanzar {
  ok: boolean;
  seguimientoId: string;
  fechaObjetivo: string;
  toast: string;
  ghl: { modo: string; efectos: { operacion: string; ok: boolean; aplicado: boolean; error?: string }[] };
}

export const registrarSeguimientoRemoto = (body: AvanzarSeguimientoBody) =>
  pedir<RespuestaAvanzar>("/closer/avanzar", {
    method: "POST",
    body: JSON.stringify({ resultado: "seguimiento", ...body }),
  });

/**
 * Traduce una fila del API a la forma que ya consumen las vistas.
 *
 * Los contactos reales se keyean por su `ghlContactId`, no por el nombre. Conviven en el
 * mismo `Record` con los 38 de la semilla —que siguen keyeados por nombre— porque la clave
 * es solo un string y a las vistas les da igual. Eso evita tener que migrar la identidad de
 * toda la app para poder mostrar tres contactos reales.
 */
export function filaAContacto(f: FilaApi): ClosurerContact {
  const situacionLabel = situacionPorSlug(f.seguimiento.situacion).label;

  return {
    // La clave del Record. Sin nombre en GHL se muestra el id: es feo, pero es cierto —
    // inventar un "Sin nombre" escondería un dato faltante (§4.10).
    name: f.nombre ?? f.ghlContactId,
    ghlContactId: f.ghlContactId,
    // Sin calificación del motor: la UI pinta "—" (§4.10). No se inventa una letra.
    grade: undefined,
    stage: "seguimiento",
    situacion: armarPildora({ stage: "seguimiento", subcategoria: situacionLabel }),
    when: "hoy",
    activity: f.fila.microtext,
    fuente: "DIRECTO",
    seguimientoAutomaticoActivo: f.seguimiento.modo === "automatico" && f.seguimiento.estado === "pendiente",
    pinned: f.fijada || undefined,
    seguimientoPendiente: { microtext: f.fila.microtext, vencido: f.fila.vencido },
    historial: [],
    // La nota del Avanzar viaja al tab Notas con su contexto (§3).
    notas: f.seguimiento.nota
      ? [{ id: 1, contexto: armarPildora({ stage: "seguimiento", subcategoria: situacionLabel }), texto: f.seguimiento.nota, autor: "Diego M.", fecha: "—" }]
      : [],
  };
}
