# Comando Central — Réplica

Réplica idéntica del dashboard **Comando Central** (Closer AI / InmoLead AI),
originalmente en `https://clone-of-ai-inmobili.vibepreview.com/closer-dashboard`.

Reconstruida como código fuente limpio y editable: **React + Vite + TypeScript + Tailwind CSS**
con el sistema de diseño **shadcn/ui** (tema violet) y los tokens de color exactos del original.

## Vistas (sincronizadas con la versión rediseñada de Francisco)

Barra lateral con secciones y switch de rol; **Sales Calls Audit** y **Gerencia** aparecen
deshabilitadas ("Próximamente"), igual que el original.

- **Closer** — tabs: Inicio (cockpit: cash collected, ventas, acuerdos, calls, show rate,
  comisión + gráfico "Histórico de Ingresos"), Mi Día (KPIs + Agenda de Hoy + Intervenciones
  urgentes), Pipeline (segmentado por etapa: Agendado / Seguimiento / Cierre en curso / Ganado /
  No-show / Descalificado, con filtros A/B/C/Destacados y "Sincronizar CRM"), Agenda (calendario +
  Próximos Días + citas con "Unirse al Meet" / "Reprogramar")
- **Setter** — cockpit de comisiones (Low-ticket, Diferidas, Agendas generadas, Show rate,
  Oportunidades LT) + tabs Mi Día y Pipeline
- **Agents Audit** — "Salud de los agentes": agentes de texto y voz (conversión, sentimiento
  positivos/neutrales/molestos, métricas operativas) + Historial de Ajustes
- **Ajustes** — Mi Cuenta (Conectar Calendario, enlace de agendamiento, Sonido de Venta)
- **Sugerir Mejora** — popover con textarea (pie de la barra lateral) + toggle de modo oscuro

## Datos

Cada vista es autónoma con datos demo/simulados en línea (sin backend), fieles al contenido
capturado del original. `src/lib/data.ts` conserva el generador de leads del bundle original.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build de producción en /dist
npm run preview  # sirve el build
```

## Estructura

```
src/
  App.tsx              # shell + sidebar + navegación
  lib/
    data.ts            # capa de datos (leads seed + generador)
    utils.ts           # helper cn()
  views/
    CloserAI.tsx       # Inicio + Mi Día + Pipeline + Agenda
    SetterView.tsx     # cockpit de comisiones (Inicio + Mi Día + Pipeline)
    AgentsAudit.tsx    # Salud de los agentes (texto/voz + historial)
    Ajustes.tsx        # Mi Cuenta
  index.css            # tokens de diseño (CSS vars shadcn) + base
```
