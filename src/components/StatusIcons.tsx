/**
 * LA fila de íconos de estado de un contacto (§8): 📹 · 📅 · 📞 · 🤖 · ⏱ · 💰
 *
 * ## Por qué existe
 *
 * Este bloque estaba duplicado en CINCO vitrinas con lógica divergente: `MiDiaRow`, el widget
 * "Agenda de Hoy", la fila del Pipeline, la fila de agendados y el header de la ficha. Las
 * consecuencias eran visibles: el mismo contacto se veía "sin bot" en una lista y "IA activa"
 * en su ficha (el header tenía un `?? "activo"` que las listas no), y el widget de Agenda
 * pasaba `llamadas: []` / `botEstado: undefined` HARDCODEADOS, apagando los íconos de
 * contactos que sí tenían el dato, justo en la pantalla que el closer mira antes de llamar.
 *
 * ## Toma UN objeto, no seis props sueltas
 *
 * Es deliberado. Con props sueltas, un caller que no tiene un dato puede "completarlo" con un
 * cero — que es exactamente cómo nació el bug del widget. Con un `IndicadoresContacto`
 * completo, o se tiene el bloque o no se tiene; no hay forma de rellenar la mitad.
 *
 * Los seis slots están SIEMPRE en el DOM (§20.B): nunca desaparecen, solo se atenúan.
 */

import { AlarmClock, Bot, Calendar, DollarSign, Phone, Video } from "lucide-react";
import { memo } from "react";
import { botIconVisual } from "../lib/closerStore";
import type { IndicadoresContacto } from "../lib/indicadores";
import { cn } from "../lib/utils";

/** El gris de "apagado" del sistema — ~25% de opacidad sobre el color de ícono inactivo. */
const APAGADO = "text-[#6b6980]/25";
const ENCENDIDO = "text-[#6b6980]";

/**
 * Columna de ancho fijo por ícono: garantiza que todas las filas alineen entre sí aunque un
 * slot (📞 "2✓") sea más ancho que un ícono suelto.
 */
function Slot({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cn("flex items-center justify-center shrink-0", wide ? "w-7" : "w-3.5")}>{children}</div>;
}

/** Fecha corta para los tooltips ("mar 5 ago, 16:00"). Solo presentación. */
const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export interface StatusIconsProps {
  ind: IndicadoresContacto;
  /** `"row"` = filas de listas (w-3.5, con slots). `"header"` = ficha del contacto (w-4, suelto). */
  size?: "row" | "header";
}

function StatusIconsBase({ ind, size = "row" }: StatusIconsProps) {
  const px = size === "header" ? "w-4 h-4" : "w-3.5 h-3.5";
  const bot = botIconVisual(ind.bot ?? undefined);

  /** En el header los íconos van sueltos con más aire; en las filas, dentro de su slot fijo. */
  const envolver = (key: string, nodo: React.ReactNode, wide = false) =>
    size === "header" ? (
      <div key={key} className="flex items-center shrink-0">
        {nodo}
      </div>
    ) : (
      <Slot key={key} wide={wide}>
        {nodo}
      </Slot>
    );

  return (
    <div className={cn("flex items-center shrink-0", size === "header" ? "gap-4" : "gap-1.5")}>
      {/* 📹 Reuniones con el closer. 0 → atenuado sin número (§4.1: el cero no se pinta). */}
      {envolver(
        "video",
        ind.reuniones > 0 ? (
          <span
            className={cn("flex items-center gap-0.5 text-[11px] font-semibold shrink-0", ENCENDIDO)}
            title={`${ind.reuniones} ${ind.reuniones === 1 ? "reunión" : "reuniones"} con el closer`}
          >
            <Video className={px} />
            {ind.reuniones}
          </span>
        ) : (
          <Video className={cn(px, APAGADO)} />
        ),
        ind.reuniones > 0,
      )}

      {/* 📅 Cita futura vigente. El tooltip dice cuándo — el ícono solo, no. */}
      {envolver(
        "cita",
        <Calendar
          className={cn(px, ind.citaFutura ? ENCENDIDO : APAGADO)}
          aria-label={ind.citaFutura ? "Tiene cita agendada" : "Sin cita agendada"}
        />,
      )}

      {/* 📞 Llamadas del agente de voz. Contestadas → "N✓"; intentos sin respuesta → "✗" atenuado. */}
      {envolver(
        "llamadas",
        (ind.llamadasIaContestadas ?? 0) > 0 ? (
          <span
            className={cn("flex items-center gap-0.5 text-[11px] font-semibold shrink-0", ENCENDIDO)}
            title={`${ind.llamadasIaContestadas} contestadas de ${ind.llamadasIaIntentos ?? ind.llamadasIaContestadas} intentos del agente de voz`}
          >
            <Phone className={px} />
            {ind.llamadasIaContestadas}✓
          </span>
        ) : (ind.llamadasIaIntentos ?? 0) > 0 ? (
          <span
            className={cn("flex items-center gap-0.5 text-[11px] font-semibold shrink-0", APAGADO)}
            title={`${ind.llamadasIaIntentos} intentos del agente de voz, ninguno contestado`}
          >
            <Phone className={px} />✗
          </span>
        ) : (
          <Phone className={cn(px, APAGADO)} />
        ),
        (ind.llamadasIaContestadas ?? 0) > 0 || (ind.llamadasIaIntentos ?? 0) > 0,
      )}

      {/* 🤖 Estado del bot. Misma fuente que el toggle del compositor (regla D.7 de §25). */}
      {envolver(
        "bot",
        bot.label ? (
          <span className={cn("flex items-center gap-0.5 text-[11px] font-semibold shrink-0", bot.className)} title={bot.title}>
            <Bot className={px} />
            {bot.label}
          </span>
        ) : (
          <span className="flex items-center shrink-0" title={bot.title}>
            <Bot className={cn(px, bot.className)} />
          </span>
        ),
        !!bot.label,
      )}

      {/* ⏱ Serie de seguimiento automático en curso. Solo lectura — nunca fue un botón (§16.1.A). */}
      {envolver(
        "seguimiento",
        <AlarmClock
          className={cn(px, ind.seguimientoAuto ? ENCENDIDO : APAGADO)}
          aria-label={ind.seguimientoAuto ? "Seguimiento automático activo" : "Sin seguimiento automático"}
        />,
      )}

      {/* 💰 Venta cobrada. Verde, y solo con dinero real detrás (§27.A). */}
      {envolver(
        "dinero",
        <DollarSign
          className={cn(px, ind.ventaMonto ? "text-emerald-600 dark:text-emerald-400" : APAGADO)}
          aria-label={ind.ventaMonto ? `Venta de $${ind.ventaMonto}` : "Sin venta registrada"}
        />,
      )}
    </div>
  );
}

/**
 * Memoizado desde el día uno: recibe un solo objeto y lo pintan todas las filas de todas las
 * listas. Su prop viene del backend, así que la referencia solo cambia cuando el dato cambia
 * de verdad — el comparador por defecto acierta.
 */
export const StatusIcons = memo(StatusIconsBase);

/** El tooltip de una cita, para las vitrinas que además muestran la fecha en texto. */
export const tooltipCita = (ind: IndicadoresContacto): string | undefined => {
  if (ind.proximaCitaEl) return `Próxima cita: ${cuando(ind.proximaCitaEl)}`;
  if (ind.ultimaCitaVencidaEl) return `Cita vencida: ${cuando(ind.ultimaCitaVencidaEl)}`;
  return undefined;
};
