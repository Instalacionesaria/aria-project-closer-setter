import { useEffect, useRef, useState } from "react";
import {
  X,
  Calendar,
  Phone,
  Bot,
  AlarmClock,
  DollarSign,
  MessageCircle,
  PhoneCall,
  UserCheck,
  History,
  MessageSquareText,
  Plus,
  Mic,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  PhoneOff,
  Video,
  CalendarClock,
  Link2,
  Send,
  Zap,
  User,
  CreditCard,
  Clock,
  UserX,
  Sprout,
  PlayCircle,
  ChevronDown,
  AlertTriangle,
  Flame,
  Star,
  HelpCircle,
  Snowflake,
  CircleDashed,
  Hourglass,
  Repeat,
  Pin,
  RotateCcw,
  Check,
} from "lucide-react";
import { cn } from "../lib/utils";
import { STAGE_META, botIconVisual, countCallsContestadas, countSalesCalls, callsIASummary, type ClosurerContact, type StageKey, type BotEstado, type CallRecord, type CallOrigin, type Sentimiento, type PerfilField, type PerfilGroup, type PerfilFormulario, type VideoPreCallInfo } from "../lib/closerStore";
import { TAG_CLS_BY_TONE, type SetterContact, type SetterStageKey, type SetterTagTone, type SetterAdvanceInput } from "../lib/setterStore";
import { useSettings } from "../lib/settingsStore";
import { playSaleSound } from "../lib/sound";
import { fetchConversation, applyContactTags } from "../lib/api";

/** Mapa salida de Avanzar (closer) → tag real de GHL (contrato Frank §9). Aplicarlo dispara el workflow de GHL. */
const STAGE_TO_GHL_TAG: Partial<Record<StageKey, string>> = {
  ganado: "venta_ganada",
  cierre: "adelanto_ganado",
  seguimiento: "seguimiento",
  descalificado: "descalificado",
  no_show: "noshow",
  nurture: "nurture_appflow",
};

type DrawerTab = "chat" | "llamada" | "perfil" | "historial" | "notas";
type Role = "closer" | "setter";

const GRADE_CIRCLE: Record<string, string> = {
  A: "bg-emerald-500/10 text-emerald-600",
  B: "bg-amber-500/10 text-amber-600",
  C: "bg-rose-500/10 text-rose-600",
  D: "bg-rose-500/10 text-rose-600",
};

const TABS: { key: DrawerTab; label: string; icon: typeof X; disabled?: boolean }[] = [
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "llamada", label: "Llamada", icon: PhoneCall },
  { key: "perfil", label: "Perfil", icon: UserCheck },
  { key: "historial", label: "Historial", icon: History },
  { key: "notas", label: "Notas", icon: MessageSquareText },
];

/* ================================================================== */
/* Avanzar — salidas por rol (glosario §3 / §12 de CLAUDE.md)          */
/* ================================================================== */

const money = (n: number) => `$${n.toLocaleString("es-AR")}`;
const shortDate = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }).replace(".", "") : "";
const isoInDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

type AvanzarResult = {
  pildora: string;
  texto: string;
  toast: string;
  monto?: number;
  celebrate?: boolean;
  nota?: string;
  stage?: StageKey;
  cadenciaActiva?: boolean;
  /** Setter (con store, 2026-07-10): equivalentes de `stage`/color para SetterAdvanceInput. */
  setterStage?: SetterStageKey;
  situacionTone?: SetterTagTone;
  agendaFecha?: string;
};

/* ---------- Closer: pantallas exactas provistas por Francisco ---------- */

type CloserOutcomeKey = "venta" | "acordo" | "seguimiento" | "no_interesa" | "no_show" | "nurture";

const CLOSER_CARDS: {
  key: CloserOutcomeKey;
  label: string;
  desc: string;
  icon: typeof CheckCircle2;
  tone: "emerald" | "blue" | "violet" | "red" | "amber";
  span2?: boolean;
}[] = [
  { key: "venta", label: "Venta", desc: "Pago total · mueve a Ganado", icon: CheckCircle2, tone: "emerald" },
  { key: "acordo", label: "Acordó comprar, falta pago", desc: "Dejó seña · falta el resto", icon: DollarSign, tone: "blue" },
  { key: "seguimiento", label: "Seguimiento", desc: "Pactar fecha · entra a tu cola", icon: Calendar, tone: "violet" },
  { key: "no_interesa", label: "No le interesa", desc: "Mueve a Descalificado · objeción", icon: XCircle, tone: "red" },
  { key: "no_show", label: "No-show", desc: "Mueve a No-show · dispara recuperación", icon: PhoneOff, tone: "amber" },
  { key: "nurture", label: "Nurture", desc: "No es ahora · a maduración", icon: Sprout, tone: "blue" },
];

const CARD_ICON_TONE: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  red: "bg-red-100 text-red-500 dark:bg-red-500/15 dark:text-red-400",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400",
};

const CONFIRM_BUTTON_TONE: Record<string, string> = {
  emerald: "bg-emerald-400 hover:bg-emerald-500 text-white",
  blue: "bg-blue-600 hover:bg-blue-700 text-white",
  violet: "bg-violet-400 hover:bg-violet-500 text-white",
  red: "bg-rose-300 hover:bg-rose-400 text-white",
  amber: "bg-amber-400 hover:bg-amber-500 text-white",
  slate: "bg-slate-400 hover:bg-slate-500 text-white",
};

/** Compartido por Chip y OptionCard — un solo mapa de color de "seleccionado" por tono. */
const SELECTED_TONE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 border-emerald-300 text-emerald-700",
  blue: "bg-blue-50 border-blue-300 text-blue-700",
  violet: "bg-violet-50 border-violet-300 text-violet-700",
  red: "bg-rose-50 border-rose-300 text-rose-700",
  amber: "bg-amber-50 border-amber-300 text-amber-700",
  slate: "bg-slate-50 border-slate-300 text-slate-700",
};

function Chip({ selected, onClick, children, tone = "violet" }: { selected: boolean; onClick: () => void; children: React.ReactNode; tone?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-sm font-medium px-3 py-2.5 rounded-xl border transition-colors text-center",
        selected ? SELECTED_TONE_CLS[tone] : "border-border bg-background dark:bg-secondary text-foreground hover:bg-muted/40"
      )}
    >
      {children}
    </button>
  );
}

/** Tarjeta de opción con icono + label + descripción (situación de Seguimiento, motivo de Nurture) — mismo lenguaje visual que el grid de Avanzar, pero apilada y con estado "seleccionado" opcional. */
function OptionCard({
  icon: Icon,
  label,
  desc,
  tone,
  selected,
  onClick,
}: {
  icon: typeof CheckCircle2;
  label: string;
  desc: string;
  tone: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-start gap-3 p-4 rounded-2xl border transition-all",
        selected
          ? cn("border-2", SELECTED_TONE_CLS[tone])
          : "border-border/60 bg-background dark:bg-secondary hover:border-border hover:shadow-sm"
      )}
    >
      <div className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0", CARD_ICON_TONE[tone])}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </button>
  );
}

function ModalShell({
  onClose,
  onBack,
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  onClose: () => void;
  onBack?: () => void;
  eyebrow?: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-[1px] animate-in fade-in duration-150" />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin bg-popover text-popover-foreground rounded-2xl shadow-2xl border border-border animate-in zoom-in-95 fade-in duration-150">
        <div className="p-5 pb-4 border-b border-border/30">
          <div className="flex items-start gap-2">
            {onBack && (
              <button onClick={onBack} className="h-7 w-7 -ml-1.5 mt-0.5 shrink-0 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              {eyebrow && <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{eyebrow}</div>}
              <h3 className="text-lg font-bold tracking-tight truncate">{title}</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
            </div>
            <button onClick={onClose} className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="p-5 pt-0">{footer}</div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{children}</label>;
}

function NotaField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <FieldLabel>Nota (¿algo que recordar?)</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Opcional..."
        className="w-full min-h-[70px] resize-none rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
      />
    </div>
  );
}

function ConfirmButton({ tone, disabled, onClick, children }: { tone: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full h-11 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none",
        CONFIRM_BUTTON_TONE[tone]
      )}
    >
      {children}
    </button>
  );
}

const NO_INTERESA_RAZONES = ["Precio", "No es el momento", "Competencia", "No califica", "Otro"];
const NO_SHOW_RAZONES = ["Avisó · quiere reagendar", "Plantón · sin aviso", "Falla técnica", "Datos incorrectos"];

function CloserAvanzar({ onClose, onConfirm }: { onClose: () => void; onConfirm: (result: AvanzarResult) => void }) {
  const withNota = (r: Omit<AvanzarResult, "nota">, nota: string): AvanzarResult => ({ ...r, nota: nota.trim() || undefined });
  const [step, setStep] = useState<CloserOutcomeKey | null>(null);

  // Venta
  const [ventaMonto, setVentaMonto] = useState("");
  const [tipoPago, setTipoPago] = useState<string | null>(null);
  // Acordó comprar
  const [acuerdoMonto, setAcuerdoMonto] = useState("");
  // No le interesa
  const [razonPerdida, setRazonPerdida] = useState<string | null>(null);
  // No-show
  const [razonNoShow, setRazonNoShow] = useState<string | null>(null);
  // Nota (compartida, se resetea por pantalla)
  const [nota, setNota] = useState("");

  const back = () => {
    setStep(null);
    setNota("");
  };

  if (!step) {
    return (
      <ModalShell
        onClose={onClose}
        eyebrow="Resultado — Llamada o Chat"
        title="¿Cómo terminó?"
        subtitle='Sirve igual tras una llamada o tras el chat ("ya no me interesa", "va, lo compro"). Un clic mueve el pipeline y dispara lo que corresponda.'
        footer={null}
      >
        <div className="grid grid-cols-2 gap-3">
          {CLOSER_CARDS.map((c) => (
            <button
              key={c.key}
              onClick={() => setStep(c.key)}
              className={cn(
                "text-left p-4 rounded-2xl border border-border/60 hover:border-border hover:shadow-sm transition-all bg-background dark:bg-secondary",
                c.span2 && "col-span-2"
              )}
            >
              <div className={cn("h-9 w-9 rounded-full flex items-center justify-center mb-3", CARD_ICON_TONE[c.tone])}>
                <c.icon className="h-4.5 w-4.5" />
              </div>
              <div className="text-sm font-bold">{c.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.desc}</div>
            </button>
          ))}
        </div>
      </ModalShell>
    );
  }

  if (step === "venta") {
    const canConfirm = Number(ventaMonto) > 0 && !!tipoPago;
    const confirm = () => {
      const monto = Number(ventaMonto);
      onConfirm(withNota({
        pildora: `VENTA · ${money(monto)}`,
        texto: `Registró Venta — ${money(monto)} (${tipoPago})`,
        toast: `Venta registrada — ${money(monto)}`,
        monto,
        celebrate: true,
        stage: "ganado",
      }, nota));
    };
    return (
      <ModalShell onClose={onClose} onBack={back} title="Registrar Cierre" subtitle="Ingresa los detalles de la venta"
        footer={<ConfirmButton tone="emerald" disabled={!canConfirm} onClick={confirm}>Guardar Venta</ConfirmButton>}>
        <div>
          <FieldLabel>Monto Total</FieldLabel>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input type="number" min={0} value={ventaMonto} onChange={(e) => setVentaMonto(e.target.value)} placeholder="0"
              className="w-full rounded-md border border-input bg-background dark:bg-secondary pl-7 pr-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <FieldLabel>Tipo de pago</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {["Contado", "Splitwise", "Buy Now Pay Later", "Cuotas"].map((t) => (
              <Chip key={t} tone="emerald" selected={tipoPago === t} onClick={() => setTipoPago(t)}>{t}</Chip>
            ))}
          </div>
        </div>
        <NotaField value={nota} onChange={setNota} />
      </ModalShell>
    );
  }

  if (step === "acordo") {
    const canConfirm = Number(acuerdoMonto) > 0;
    const confirm = () => {
      const monto = Number(acuerdoMonto);
      onConfirm(withNota({
        pildora: `ACORDÓ COMPRAR · ${money(monto)}`,
        texto: `Registró Acordó comprar, falta pago — seña ${money(monto)}`,
        toast: `Acuerdo registrado — seña ${money(monto)}`,
        monto,
        stage: "cierre",
      }, nota));
    };
    return (
      <ModalShell onClose={onClose} onBack={back} title="Registrar: Acordó comprar, falta pago" subtitle="Ingresa el monto de la seña o promesa"
        footer={<ConfirmButton tone="blue" disabled={!canConfirm} onClick={confirm}>Guardar acuerdo</ConfirmButton>}>
        <div>
          <FieldLabel>Monto asegurado (USD)</FieldLabel>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input type="number" min={0} value={acuerdoMonto} onChange={(e) => setAcuerdoMonto(e.target.value)} placeholder="0"
              className="w-full rounded-md border border-input bg-background dark:bg-secondary pl-7 pr-3 py-2 text-sm" />
          </div>
        </div>
        <NotaField value={nota} onChange={setNota} />
      </ModalShell>
    );
  }

  if (step === "no_interesa") {
    const canConfirm = !!razonPerdida;
    const confirm = () => {
      onConfirm(withNota({
        pildora: `NO LE INTERESA · ${(razonPerdida ?? "").toUpperCase()}`,
        texto: `Registró No le interesa — ${razonPerdida}`,
        toast: "Prospecto descalificado",
        stage: "descalificado",
      }, nota));
    };
    return (
      <ModalShell onClose={onClose} onBack={back} title="Descalificar Prospecto" subtitle="Selecciona la razón principal"
        footer={<ConfirmButton tone="red" disabled={!canConfirm} onClick={confirm}>Confirmar Descalificación</ConfirmButton>}>
        <div>
          <FieldLabel>Razón de descalificación</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {NO_INTERESA_RAZONES.map((r, i) => (
              <div key={r} className={i === NO_INTERESA_RAZONES.length - 1 && NO_INTERESA_RAZONES.length % 2 === 1 ? "col-span-2" : ""}>
                <Chip tone="red" selected={razonPerdida === r} onClick={() => setRazonPerdida(r)}>{r}</Chip>
              </div>
            ))}
          </div>
        </div>
        <NotaField value={nota} onChange={setNota} />
      </ModalShell>
    );
  }

  if (step === "seguimiento") {
    return <CloserSeguimientoFlow onClose={onClose} onBack={back} onConfirm={onConfirm} />;
  }

  if (step === "nurture") {
    return <NurtureScreen onClose={onClose} onBack={back} onConfirm={onConfirm} stage="nurture" />;
  }

  // no_show
  const canConfirm = !!razonNoShow;
  const confirm = () => {
    onConfirm(withNota({
      pildora: `NO-SHOW · ${(razonNoShow ?? "").split(" · ")[0].toUpperCase()}`,
      texto: `Registró No-show — ${razonNoShow}`,
      toast: "No-show registrado",
      stage: "no_show",
    }, nota));
  };
  return (
    <ModalShell onClose={onClose} onBack={back} title="Registrar No-show" subtitle="Selecciona la razón"
      footer={<ConfirmButton tone="amber" disabled={!canConfirm} onClick={confirm}>Confirmar No-show</ConfirmButton>}>
      <div>
        <FieldLabel>Razón del no-show</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {NO_SHOW_RAZONES.map((r) => (
            <Chip key={r} tone="amber" selected={razonNoShow === r} onClick={() => setRazonNoShow(r)}>{r}</Chip>
          ))}
        </div>
      </div>
      <NotaField value={nota} onChange={setNota} />
    </ModalShell>
  );
}

/* ---------- Setter: Seguimiento (§ rediseño 2026-07-09 — reemplaza fecha+subcategoría) ---------- */

function GroupLabel({ icon: Icon, iconClassName, title, subtitle }: { icon: typeof Zap; iconClassName?: string; title: string; subtitle: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-foreground">
        <Icon className={cn("h-3.5 w-3.5", iconClassName)} />
        {title}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5 ml-5">{subtitle}</div>
    </div>
  );
}

function SeguimientoRow({
  icon: Icon,
  label,
  meta,
  selected,
  onClick,
}: {
  icon?: typeof CalendarClock;
  label: string;
  meta: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors",
        selected
          ? "border-violet-300 bg-violet-50 dark:bg-violet-500/10 dark:border-violet-500/30"
          : "border-border bg-background dark:bg-secondary hover:bg-muted/40"
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        {label}
      </span>
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{meta}</span>
    </button>
  );
}

/** Grupo automático — opciones distintas por rol (Setter: 2 series; Closer: Recupero). */
const SETTER_AUTO_SEGUIMIENTO: { key: string; meta: string; icon?: typeof Repeat }[] = [
  { key: "Para agendar", meta: "3 toques · 5 días" },
  { key: "Para decisión LT", meta: "2 toques · 3 días" },
];
const CLOSER_AUTO_SEGUIMIENTO: { key: string; meta: string; icon?: typeof Repeat }[] = [
  { key: "Recupero", meta: "3 toques · 7 días", icon: Repeat },
];

const MANUAL_SEGUIMIENTO: { key: string; meta: string; icon?: typeof CalendarClock }[] = [
  { key: "Mañana", meta: "En 1 día" },
  { key: "En 3 días", meta: "Corto plazo" },
  { key: "1 semana", meta: "Mediano plazo" },
  { key: "Personalizada", meta: "Elegir fecha", icon: CalendarClock },
];

/**
 * Compartido Setter/Closer (§ rediseño 2026-07-09): mismo componente, mismo comportamiento — solo
 * cambian las opciones del grupo automático. `situacionPill` (§ rediseño 2-pantallas del closer,
 * 2026-07-11): cuando viene provisto, la píldora final SIEMPRE es `SEGUIMIENTO · {situacionPill}` —
 * automático o manual — porque la subcategoría ya la decidió la pantalla 1 (Situación), no el modo.
 * Sin `situacionPill` (Setter, sin cambios), el comportamiento es el de siempre.
 */
function SeguimientoScreen({
  onClose,
  onBack,
  onConfirm,
  autoOptions,
  stage,
  setterStage,
  situacionTone,
  situacionPill,
}: {
  onClose: () => void;
  onBack: () => void;
  onConfirm: (result: AvanzarResult) => void;
  autoOptions: { key: string; meta: string; icon?: typeof Repeat }[];
  stage?: StageKey;
  setterStage?: SetterStageKey;
  situacionTone?: SetterTagTone;
  situacionPill?: string;
}) {
  const [autoPick, setAutoPick] = useState<string | null>(null);
  const [manualPick, setManualPick] = useState<string | null>(null);
  const [customFecha, setCustomFecha] = useState("");
  const [nota, setNota] = useState("");

  const pickAuto = (key: string) => {
    setAutoPick(key);
    setManualPick(null);
    setCustomFecha("");
  };
  const pickManual = (key: string) => {
    setManualPick(key);
    setAutoPick(null);
    if (key !== "Personalizada") setCustomFecha("");
  };

  const manualOk = manualPick === "Personalizada" ? !!customFecha : !!manualPick;
  const canConfirm = !!autoPick || (!!manualPick && manualOk);

  const confirm = () => {
    if (autoPick) {
      onConfirm({
        pildora: situacionPill ? `SEGUIMIENTO · ${situacionPill}` : `SEGUIMIENTO · ${autoPick.toUpperCase()}`,
        texto: `Seguimiento automático · ${autoPick}`,
        toast: "Seguimiento automático activado",
        nota: nota.trim() || undefined,
        stage,
        setterStage,
        situacionTone,
        cadenciaActiva: true,
      });
      return;
    }
    const effectiveFecha = manualPick === "Personalizada" ? customFecha : isoInDays(manualPick === "Mañana" ? 1 : manualPick === "En 3 días" ? 3 : 7);
    onConfirm({
      pildora: situacionPill ? `SEGUIMIENTO · ${situacionPill}` : `SEGUIMIENTO — ${shortDate(effectiveFecha).toUpperCase()}`,
      texto: `Seguimiento manual · para el ${shortDate(effectiveFecha)}`,
      toast: `Seguimiento programado — ${shortDate(effectiveFecha)}`,
      nota: nota.trim() || undefined,
      stage,
      setterStage,
      situacionTone,
      cadenciaActiva: false,
    });
  };

  return (
    <ModalShell onClose={onClose} onBack={onBack} title="Programar Seguimiento" subtitle="Selecciona cuándo quieres que te recordemos"
      footer={<ConfirmButton tone="violet" disabled={!canConfirm} onClick={confirm}>Programar Seguimiento</ConfirmButton>}>
      <div className={cn("space-y-2 transition-opacity", manualPick && "opacity-40")}>
        <GroupLabel icon={Zap} iconClassName="text-amber-500" title="Seguimiento automático" subtitle="El sistema persigue por ti" />
        {autoOptions.map((o) => (
          <SeguimientoRow key={o.key} icon={o.icon} label={o.key} meta={o.meta} selected={autoPick === o.key} onClick={() => pickAuto(o.key)} />
        ))}
      </div>
      <div className={cn("space-y-2 transition-opacity", autoPick && "opacity-40")}>
        <GroupLabel icon={User} title="Seguimiento manual" subtitle="Tú lo retomas" />
        {MANUAL_SEGUIMIENTO.map((o) => (
          <SeguimientoRow key={o.key} icon={o.icon} label={o.key} meta={o.meta} selected={manualPick === o.key} onClick={() => pickManual(o.key)} />
        ))}
        {manualPick === "Personalizada" && (
          <input
            type="date"
            value={customFecha}
            onChange={(e) => setCustomFecha(e.target.value)}
            className="w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
          />
        )}
      </div>
      <NotaField value={nota} onChange={setNota} />
    </ModalShell>
  );
}

/* ---------- Closer: Seguimiento en 2 pantallas — Situación → Modo (DISEÑO APROBADO, 2026-07-11) ---------- */

const CLOSER_SITUACIONES: { label: string; desc: string; icon: typeof Flame; tone: string }[] = [
  { label: "Próximo a pagar", desc: "Dijo que sí, es cuestión de días", icon: Flame, tone: "emerald" },
  { label: "Muy interesado", desc: "Quiere, sin fecha de pago aún", icon: Star, tone: "amber" },
  { label: "Dudando", desc: "Tiene una objeción sin resolver", icon: HelpCircle, tone: "violet" },
  { label: "Enfriándose", desc: "Perdiendo interés, riesgo de fuga", icon: Snowflake, tone: "blue" },
  { label: "Otro", desc: "Situación no listada", icon: CircleDashed, tone: "slate" },
];

/** Pantalla 1 (Situación) → pantalla 2 (Modo, = SeguimientoScreen de siempre). La situación decide la subcategoría de la píldora; el modo solo decide automático/manual y la fecha de la 2ª línea. */
function CloserSeguimientoFlow({
  onClose,
  onBack,
  onConfirm,
}: {
  onClose: () => void;
  onBack: () => void;
  onConfirm: (result: AvanzarResult) => void;
}) {
  const [situacion, setSituacion] = useState<(typeof CLOSER_SITUACIONES)[number] | null>(null);

  if (!situacion) {
    return (
      <ModalShell onClose={onClose} onBack={onBack} eyebrow="Seguimiento" title="¿Cómo está el contacto?"
        subtitle="Elige la situación real del contacto — decide la subcategoría de la píldora." footer={null}>
        <div className="space-y-2">
          {CLOSER_SITUACIONES.map((s) => (
            <OptionCard key={s.label} icon={s.icon} label={s.label} desc={s.desc} tone={s.tone} onClick={() => setSituacion(s)} />
          ))}
        </div>
      </ModalShell>
    );
  }

  return (
    <SeguimientoScreen
      onClose={onClose}
      onBack={() => setSituacion(null)}
      onConfirm={onConfirm}
      autoOptions={CLOSER_AUTO_SEGUIMIENTO}
      stage="seguimiento"
      situacionPill={situacion.label.toUpperCase()}
    />
  );
}

/* ---------- Nurture — compartido Closer/Setter (DISEÑO APROBADO, 2026-07-11) ---------- */

const NURTURE_REASONS: { key: string; label: string; desc: string; icon: typeof Hourglass }[] = [
  { key: "Pidió tiempo", label: "Pidió tiempo", desc: "Quiere, pero no ahora (presupuesto o timing)", icon: Hourglass },
  { key: "Se enfrió", label: "Se enfrió", desc: "Perdió el impulso, sin decir que no", icon: Snowflake },
];

const NURTURE_PILL: Record<string, string> = { "Pidió tiempo": "PIDIÓ TIEMPO", "Se enfrió": "SE ENFRIÓ" };

function NurtureScreen({
  onClose,
  onBack,
  onConfirm,
  stage,
  setterStage,
  situacionTone,
}: {
  onClose: () => void;
  onBack: () => void;
  onConfirm: (result: AvanzarResult) => void;
  stage?: StageKey;
  setterStage?: SetterStageKey;
  situacionTone?: SetterTagTone;
}) {
  const [motivo, setMotivo] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const canConfirm = !!motivo;

  const confirm = () => {
    if (!motivo) return;
    onConfirm({
      pildora: `NURTURE · ${NURTURE_PILL[motivo]}`,
      texto: `Registró Nurture — ${motivo}`,
      toast: "Nurture registrado",
      nota: nota.trim() || undefined,
      stage,
      setterStage,
      situacionTone,
    });
  };

  return (
    <ModalShell onClose={onClose} onBack={onBack} title="Enviar a Nurture" subtitle="No es ahora, pero no está muerto"
      footer={<ConfirmButton tone="blue" disabled={!canConfirm} onClick={confirm}>Enviar a Nurture</ConfirmButton>}>
      <div>
        <FieldLabel>¿Por qué a nurture?</FieldLabel>
        <div className="space-y-2">
          {NURTURE_REASONS.map((r) => (
            <OptionCard key={r.key} icon={r.icon} label={r.label} desc={r.desc} tone="blue" selected={motivo === r.key} onClick={() => setMotivo(r.key)} />
          ))}
        </div>
      </div>
      <NotaField value={nota} onChange={setNota} />
    </ModalShell>
  );
}

/* ---------- Setter: placeholder genérico (a la espera de las pantallas reales) ---------- */

type FieldDef =
  | { name: string; type: "currency"; label: string; required?: boolean; prefill?: number }
  | { name: string; type: "date" | "datetime"; label: string; required?: boolean }
  | { name: string; type: "select"; label: string; options: string[]; required?: boolean };

type SetterOutcomeKey = "agendo" | "venta_lt" | "seguimiento" | "no_califica" | "nurture";

type OutputDef = {
  key: SetterOutcomeKey;
  subcategories?: string[];
  fields?: FieldDef[];
};

const LT_PRODUCTS = ["Masterclass — $97", "Curso Intensivo — $297", "Mentoría Express — $500"];
const ltPrefill = (producto: string) => Number(producto.split("$")[1] ?? 0);

const SETTER_OUTPUTS: OutputDef[] = [
  { key: "agendo", fields: [
    { name: "fecha", type: "datetime", label: "Fecha y hora de la cita", required: true },
  ] },
  { key: "venta_lt", fields: [
    { name: "producto", type: "select", label: "Producto", required: true, options: LT_PRODUCTS },
    { name: "monto", type: "currency", label: "Monto", required: true },
    { name: "forma_pago", type: "select", label: "Forma de pago", required: true, options: ["Transferencia", "Tarjeta", "Efectivo", "Otro"] },
  ] },
  { key: "seguimiento" },
  { key: "no_califica", subcategories: [
    "Sin capital", "Sin urgencia", "No es el perfil", "Datos falsos",
  ] },
  { key: "nurture" },
];

/** Grid "¿Cómo termina?" del setter (referencia de Francisco, 2026-07-10) — icono + label + desc, mismo estilo que CLOSER_CARDS. */
const SETTER_CARDS: { key: SetterOutcomeKey; label: string; desc: string; icon: typeof Calendar; tone: "emerald" | "blue" | "violet" | "red" | "amber" }[] = [
  { key: "agendo", label: "Agendó", desc: "Coordinado manualmente", icon: Calendar, tone: "emerald" },
  { key: "venta_lt", label: "Venta Low-Ticket", desc: "Suma a comisiones", icon: CreditCard, tone: "violet" },
  { key: "seguimiento", label: "Seguimiento", desc: "Pactar fecha · entra a tu cola", icon: Clock, tone: "amber" },
  { key: "no_califica", label: "No califica", desc: "Descalifica por perfil", icon: UserX, tone: "red" },
  { key: "nurture", label: "Nurture", desc: "No es ahora · a maduración", icon: Sprout, tone: "blue" },
];

const SETTER_DETAIL_META: Record<SetterOutcomeKey, { title: string; subtitle: string; cta: string }> = {
  agendo: { title: "Registrar Agendó", subtitle: "Ingresa la fecha y hora de la cita coordinada", cta: "Guardar" },
  venta_lt: { title: "Registrar Venta Low-Ticket", subtitle: "Selecciona el producto y confirma el monto", cta: "Guardar Venta" },
  seguimiento: { title: "Programar Seguimiento", subtitle: "Selecciona cuándo quieres que te recordemos", cta: "Programar Seguimiento" },
  no_califica: { title: "Descalificar Prospecto", subtitle: "Selecciona la razón principal", cta: "Confirmar Descalificación" },
  nurture: { title: "Enviar a Nurture", subtitle: "Selecciona el motivo", cta: "Confirmar Nurture" },
};

function buildSetterResult(output: OutputDef, subcat: string | null, values: Record<string, string>): AvanzarResult {
  const monto = values.monto ? Number(values.monto) : undefined;
  switch (output.key) {
    case "agendo":
      return { pildora: "AGENDADO", texto: `Registró Agendó — cita ${values.fecha}`, toast: "Cita agendada", setterStage: "agendado", situacionTone: "emerald", agendaFecha: values.fecha };
    case "venta_lt":
      return { pildora: `LOW-TICKET · VENDIDO ${money(monto ?? 0)}`, texto: `Registró Venta Low-Ticket — ${values.producto} (${money(monto ?? 0)}, ${values.forma_pago})`, toast: `Venta LT registrada — ${money(monto ?? 0)}`, monto, celebrate: true, setterStage: "low_ticket_ofrecido", situacionTone: "emerald" };
    case "no_califica":
      return { pildora: "DESCALIFICADO", texto: `Registró No califica — ${subcat}`, toast: "Prospecto descalificado", setterStage: "descalificado", situacionTone: "rose" };
    // "nurture" se intercepta antes de llegar aquí (ver NurtureScreen en SetterAvanzarModal) — nunca se invoca con ese key.
  }
  return { pildora: "—", texto: "Registró un resultado", toast: "Registrado", setterStage: "en_calificacion", situacionTone: "source" };
}

/** Setter: grid "¿Cómo termina?" (referencia de Francisco, 2026-07-10) + pantallas de detalle, mismo patrón de navegación que CloserAvanzar. */
function SetterAvanzarModal({
  name,
  onClose,
  onConfirm,
}: {
  name: string;
  onClose: () => void;
  onConfirm: (result: AvanzarResult) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<SetterOutcomeKey | null>(null);
  const [subcat, setSubcat] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [nota, setNota] = useState("");

  const selected = SETTER_OUTPUTS.find((o) => o.key === selectedKey) ?? null;

  const pick = (key: SetterOutcomeKey) => {
    setSelectedKey(key);
    setSubcat(null);
    setValues({});
    setNota("");
  };
  const back = () => {
    setSelectedKey(null);
    setNota("");
  };

  const setField = (fname: string, v: string) => setValues((prev) => ({ ...prev, [fname]: v }));

  const visibleFields = selected?.fields ?? [];
  const requiredFieldsOk = visibleFields.every((f) => (!("required" in f) || !f.required) || !!values[f.name]?.trim());
  const subcatOk = !selected?.subcategories || !!subcat;
  const canConfirm = !!selected && subcatOk && requiredFieldsOk;

  useEffect(() => {
    if (selected?.fields) {
      const producto = selected.fields.find((f) => f.name === "producto");
      if (producto && values.producto && !values.monto) {
        setField("monto", String(ltPrefill(values.producto)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.producto]);

  const confirm = () => {
    if (!selected || !canConfirm) return;
    onConfirm({ ...buildSetterResult(selected, subcat, values), nota: nota.trim() || undefined });
  };

  if (selectedKey === "seguimiento") {
    return (
      <SeguimientoScreen
        onClose={onClose}
        onBack={back}
        onConfirm={onConfirm}
        autoOptions={SETTER_AUTO_SEGUIMIENTO}
        setterStage="en_calificacion"
        situacionTone="amber"
      />
    );
  }

  if (selectedKey === "nurture") {
    return <NurtureScreen onClose={onClose} onBack={back} onConfirm={onConfirm} setterStage="nurture" situacionTone="violet" />;
  }

  if (selected) {
    const card = SETTER_CARDS.find((c) => c.key === selectedKey)!;
    const meta = SETTER_DETAIL_META[selectedKey!];
    return (
      <ModalShell onClose={onClose} onBack={back} title={meta.title} subtitle={meta.subtitle}
        footer={<ConfirmButton tone={card.tone} disabled={!canConfirm} onClick={confirm}>{meta.cta}</ConfirmButton>}>
        {selected.subcategories && (
          <div>
            <FieldLabel>Subcategoría (obligatoria)</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {selected.subcategories.map((s, i) => (
                <div key={s} className={i === selected.subcategories!.length - 1 && selected.subcategories!.length % 2 === 1 ? "col-span-2" : ""}>
                  <Chip tone={card.tone} selected={subcat === s} onClick={() => setSubcat(s)}>{s}</Chip>
                </div>
              ))}
            </div>
          </div>
        )}

        {visibleFields.map((f) => (
          <div key={f.name}>
            <FieldLabel>{f.label}</FieldLabel>
            {f.type === "select" ? (
              <select
                value={values[f.name] ?? ""}
                onChange={(e) => setField(f.name, e.target.value)}
                className="w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
              >
                <option value="" disabled>Elegir…</option>
                {f.options.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            ) : f.type === "currency" ? (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  value={values[f.name] ?? (f.prefill ?? "")}
                  onChange={(e) => setField(f.name, e.target.value)}
                  placeholder="0"
                  className="w-full rounded-md border border-input bg-background dark:bg-secondary pl-7 pr-3 py-2 text-sm"
                />
              </div>
            ) : (
              <input
                type={f.type === "datetime" ? "datetime-local" : "date"}
                value={values[f.name] ?? ""}
                onChange={(e) => setField(f.name, e.target.value)}
                className="w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
              />
            )}
          </div>
        ))}

        <NotaField value={nota} onChange={setNota} />
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} eyebrow="Resultado — Llamada o Chat" title={name} subtitle="Registra el avance del prospecto en la fase de pre-agenda." footer={null}>
      <div className="grid grid-cols-2 gap-3">
        {SETTER_CARDS.map((c) => (
          <button
            key={c.key}
            onClick={() => pick(c.key)}
            className="text-left p-4 rounded-2xl border border-border/60 hover:border-border hover:shadow-sm transition-all bg-background dark:bg-secondary"
          >
            <div className={cn("h-9 w-9 rounded-full flex items-center justify-center mb-3", CARD_ICON_TONE[c.tone])}>
              <c.icon className="h-4.5 w-4.5" />
            </div>
            <div className="text-sm font-bold">{c.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{c.desc}</div>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

/** Dispatcher: cada rol tiene su propio lenguaje visual de Avanzar. */
function AvanzarModal({
  role,
  name,
  onClose,
  onConfirm,
}: {
  role: Role;
  name: string;
  onClose: () => void;
  onConfirm: (result: AvanzarResult) => void;
}) {
  return role === "closer" ? (
    <CloserAvanzar onClose={onClose} onConfirm={onConfirm} />
  ) : (
    <SetterAvanzarModal name={name} onClose={onClose} onConfirm={onConfirm} />
  );
}

/** Celebración dorada — reservada para Venta (regla: dorado = dinero/logro, solo eso). */
function Celebration({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center pointer-events-none">
      <div className="animate-in zoom-in fade-in duration-300 bg-gradient-to-br from-amber-300 to-yellow-500 text-zinc-900 px-10 py-8 rounded-3xl shadow-2xl flex flex-col items-center gap-2">
        <span className="text-4xl">🎉</span>
        <span className="text-lg font-bold">¡Venta registrada!</span>
      </div>
    </div>
  );
}

/** Notificación elegante tras cualquier resultado de Avanzar. */
function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed top-6 right-6 z-[80] animate-in slide-in-from-top-2 fade-in duration-200">
      <div className="flex items-center gap-3 bg-popover text-popover-foreground border border-border shadow-lg rounded-xl px-4 py-3 max-w-xs">
        <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <span className="text-sm font-medium leading-snug">{message}</span>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Drawer                                                              */
/* ================================================================== */

type HistorialItem = { fecha: string; texto: string; autor: string };
type NotaItem = { id: number; contexto: string | null; texto: string; autor: string; fecha: string };

const HISTORIAL_SEED: HistorialItem[] = [
  { fecha: "27 Jun", texto: "Interacción inicial con IA", autor: "Sistema" },
  { fecha: "27 Jun", texto: "Agendó llamada de ventas", autor: "Sistema" },
];

const NOTAS_SEED: NotaItem[] = [
  { id: 0, contexto: "Venta LT", texto: "Compró la masterclass para empezar", autor: "Setter", fecha: "8 jul, 02:05" },
];

export default function ContactDrawer({
  name,
  onClose,
  role = "closer",
  contact = null,
  setterContact = null,
  ghlContactId = null,
  onAdvance,
  onSetterAdvance,
  onAddNota,
  onResolveIntervention,
  onBotStateChange,
  onPin,
  onComplete,
  onRevive,
}: {
  name: string | null;
  onClose: () => void;
  role?: Role;
  /** contactId de GHL — si viene, el Chat trae la conversación REAL de ese contacto. */
  ghlContactId?: string | null;
  /** Cuando se provee (closer con store compartida), la ficha refleja este registro en vivo. */
  contact?: ClosurerContact | null;
  /** Setter con store propia (setterStore.tsx, 2026-07-10) — misma idea que `contact` para closer. */
  setterContact?: SetterContact | null;
  onAdvance?: (result: AvanzarResult) => void;
  onSetterAdvance?: (input: SetterAdvanceInput) => void;
  onAddNota?: (texto: string) => void;
  /** "Marcar como Resuelto" en Intervenciones Urgentes — libera al contacto y reactiva la IA. */
  onResolveIntervention?: () => void;
  /** Cambios de estado del toggle 🤖. */
  onBotStateChange?: (estado: BotEstado, evento: string, autor?: string) => void;
  /** FIJAR (§ toast/pin, 2026-07-11): sube la tarea de Respondieron/Buzón/Oportunidad LT al tope sin completarla. */
  onPin?: () => void;
  /** Completa la tarea — automático (barra de progreso, 5s) o manual (botón "Completar Tarea" en la ficha). */
  onComplete?: () => void;
  /** Demo: simula que el contacto "escribió de nuevo" tras estar completado — reabre la tarea. */
  onRevive?: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("chat");
  const [avanzarOpen, setAvanzarOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { miCuenta } = useSettings();

  // Fallback local — red de seguridad si algún día ContactDrawer se invoca sin contact/setterContact de una store.
  const [localPildora, setLocalPildora] = useState("EN CALIFICACIÓN · PARCIAL 3/8");
  const [localMonto, setLocalMonto] = useState<number | null>(null);
  const [localHistorial, setLocalHistorial] = useState<HistorialItem[]>(HISTORIAL_SEED);
  const [localBotEstado, setLocalBotEstado] = useState<BotEstado>("activo");
  const [localNotas, setLocalNotas] = useState<NotaItem[]>(NOTAS_SEED);

  useEffect(() => {
    if (name) setTab("chat");
  }, [name]);

  useEffect(() => {
    if (!name || contact || setterContact) return;
    setLocalPildora("EN CALIFICACIÓN · PARCIAL 3/8");
    setLocalMonto(null);
    setLocalHistorial(HISTORIAL_SEED);
    setLocalNotas(NOTAS_SEED);
    setLocalBotEstado("activo");
  }, [name, contact, setterContact]);

  if (!name) return null;

  const grade = contact ? contact.grade : setterContact ? setterContact.grade : undefined;
  const pildora = contact ? contact.situacion : setterContact ? setterContact.situacion : localPildora;
  // STAGE_META/TAG_CLS_BY_TONE son fragmentos/clases completas por rol; nunca se mezclan entre sí.
  const pildoraCls = contact
    ? cn("inline-flex items-center border font-semibold px-2.5 py-1 rounded-md text-[11px] truncate uppercase tracking-wider", STAGE_META[contact.stage].pill)
    : setterContact
      ? TAG_CLS_BY_TONE[setterContact.situacionTone]
      : "inline-flex items-center border font-semibold px-2.5 py-1 rounded-md text-[11px] truncate uppercase tracking-wider bg-cyan-50 text-cyan-700 border-cyan-200/60 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30";
  const historial = contact ? contact.historial : setterContact ? setterContact.historial : localHistorial;
  const notas = contact ? contact.notas : setterContact ? setterContact.notas : localNotas;
  const urgenteDetail = contact?.urgente?.detail ?? setterContact?.urgente?.detail;
  const llamadas = contact?.llamadas ?? setterContact?.llamadas;
  // $ — SOLO pago real verificado (regla: nunca por monto potencial/"acordó comprar"). Closer: solo en stage "ganado". Setter: `monto` ya es exclusivamente pago real (venta_lt), sin gating extra.
  const ventaMonto = contact
    ? (contact.stage === "ganado" ? contact.monto ?? null : null)
    : setterContact
      ? setterContact.monto ?? null
      : localMonto;
  // 📅 — presencia de una cita real (nunca por stage/texto).
  const agendaActive = contact ? !!contact.agenda : setterContact ? !!setterContact.agendaFecha : false;
  // 📹 — cuenta reuniones/llamadas CON EL CLOSER (`sales_call`) desde `llamadas` (2026-07-11) — reemplaza al viejo flag 🎙 y a la derivación por `agenda.meetUrl`.
  const salesCallsCount = countSalesCalls(llamadas);
  // 📞 — cuenta llamadas de IA contestadas desde `llamadas` (§ auditoría íconos, 2026-07-10) — nunca un campo aparte.
  const callsCount = countCallsContestadas(llamadas);
  const cadenciaActiva = contact ? contact.cadenciaActiva : setterContact ? setterContact.cadenciaActiva : undefined;
  // IG no tiene bot (§11) — para closer se deriva de `fuente`; para setter, del `canal` del contacto.
  const hasBot = contact ? contact.fuente !== "📷 IG PROFILE" : setterContact ? setterContact.canal !== "instagram" : true;
  // § toast/pin (2026-07-11) — hay una tarea de conversación activa que la barra de progreso completa/pinea: Respondieron (closer/setter) u Oportunidad LT (setter).
  // § correcciones toast/pin v2 (2026-07-11): "tarea de conversación" ya no es solo Respondieron/Oportunidad LT — también Seguimientos de hoy (y, en Setter, Estancadas). Únicas excepciones: Urgentes (su propio flujo de "Marcar como Resuelto") y Agenda (se cierra con Avanzar).
  const hasReplyTask = contact
    ? !!(contact.respondido || contact.seguimientoPendiente)
    : setterContact
      ? !!(setterContact.respondido || setterContact.oportunidadLt || setterContact.seguimientoPendiente || setterContact.estancada)
      : false;
  const isCompletedToday = contact ? !!contact.completedToday : setterContact ? !!setterContact.completedToday : false;
  const isPinned = contact ? !!contact.pinned : setterContact ? !!setterContact.pinned : false;
  // Tab Perfil (§ auditoría v2, 2026-07-11) — campos reales agrupados por significado, sin importar rol/formulario de origen.
  const perfilFields: PerfilField[] = contact?.perfil ?? setterContact?.perfil ?? [];
  const videoPreCall: VideoPreCallInfo | undefined = contact?.videoPreCall;
  const botEstado: BotEstado = contact
    ? (contact.botEstado ?? "activo")
    : setterContact
      ? (setterContact.botEstado ?? "activo")
      : localBotEstado;
  const handleBotStateChange = (estado: BotEstado, evento: string, autor: string = "Usuario Activo") => {
    if (onBotStateChange) {
      onBotStateChange(estado, evento, autor);
    } else {
      setLocalBotEstado(estado);
      setLocalHistorial((prev) => [{ fecha: "Hoy", texto: evento, autor }, ...prev]);
    }
  };

  const handleConfirmAvanzar = (result: AvanzarResult) => {
    // Escritura REAL en GHL: si la ficha se abrió con un contacto real (ghlContactId), aplicar el tag
    // que corresponde a la salida elegida → dispara el workflow de GHL (mueve stage, etc.). Rol de Kevin.
    if (ghlContactId && role === "closer" && result.stage) {
      const tag = STAGE_TO_GHL_TAG[result.stage];
      if (tag) {
        applyContactTags(ghlContactId, [tag]).catch((e) => console.error("[Avanzar→GHL] no se pudo aplicar el tag:", e));
      }
    }
    if (onAdvance && result.stage) {
      onAdvance(result);
    } else if (onSetterAdvance && result.setterStage && result.situacionTone) {
      onSetterAdvance({
        stage: result.setterStage,
        pildora: result.pildora,
        situacionTone: result.situacionTone,
        texto: result.texto,
        monto: result.monto,
        nota: result.nota,
        cadenciaActiva: result.cadenciaActiva,
        agendaFecha: result.agendaFecha,
      });
    } else {
      setLocalPildora(result.pildora);
      setLocalHistorial((prev) => [{ fecha: "Hoy", texto: result.texto, autor: "Usuario Activo" }, ...prev]);
      if (result.monto) setLocalMonto(result.monto);
      if (result.nota) {
        setLocalNotas((prev) => [
          { id: Date.now(), contexto: result.pildora, texto: result.nota!, autor: "Usuario Activo", fecha: "Hoy" },
          ...prev,
        ]);
      }
    }
    setAvanzarOpen(false);
    setToast(result.toast);
    setTimeout(() => setToast(null), 3200);
    if (result.celebrate) {
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1600);
      playSaleSound(miCuenta.sonidoVenta);
    }
  };

  const handleAddNota = (texto: string) => {
    if (onAddNota) onAddNota(texto);
    else setLocalNotas((prev) => [{ id: Date.now(), contexto: null, texto, autor: "Usuario Activo", fecha: "Hoy" }, ...prev]);
  };

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200"
      />
      {/* Sheet */}
      <div className="fixed z-50 inset-y-0 right-0 h-full border-l w-full sm:max-w-[540px] p-0 flex flex-col border-l-border/20 bg-[#f5f5f7] dark:bg-card text-foreground shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header — inamovible; regla estricta: los íconos de la derecha son de SOLO LECTURA, nunca clicables */}
        <div className="pt-8 px-6 pb-6 bg-card/80 backdrop-blur-2xl border-b border-border/30 shrink-0 z-10 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                  grade ? GRADE_CIRCLE[grade] : "bg-muted text-muted-foreground",
                )}
              >
                {grade ?? "—"}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-foreground truncate flex items-center gap-1.5">
                  {name}
                  {isPinned && <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                </h2>
                <p className="text-xs text-muted-foreground truncate mt-0.5">+54 911 3333 4444</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasReplyTask && !isCompletedToday && (
                <button
                  onClick={isPinned ? onComplete : onPin}
                  title={isPinned ? "Cierra la tarea y la mueve a Completadas Hoy" : "Pinea la tarea arriba de su sección — no se completa"}
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-full border transition-colors whitespace-nowrap",
                    isPinned
                      ? "border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Pin className="w-3 h-3" />
                  {isPinned ? "Completar Tarea" : "Fijar Tarea"}
                </button>
              )}
              <button
                onClick={onClose}
                className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={pildoraCls}>
                {pildora}
              </div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              {salesCallsCount > 0 ? (
                <div className="flex items-center gap-0.5 text-[11px] font-semibold text-[#6b6980]" title="Reuniones con el closer">
                  <Video className="w-4 h-4" />
                  {salesCallsCount}
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[#6b6980]/25" title="Sin reuniones con el closer">
                  <Video className="w-4 h-4" />
                </div>
              )}
              <div
                className={cn("flex items-center gap-1", agendaActive ? "text-[#6b6980]" : "text-[#6b6980]/25")}
                title={agendaActive ? "Tiene cita agendada" : "Sin cita agendada"}
              >
                <Calendar className="w-4 h-4" />
              </div>
              {callsCount > 0 ? (
                <div className="flex items-center gap-0.5 text-[11px] font-semibold text-[#6b6980]" title="Contestó">
                  <Phone className="w-4 h-4" />
                  {callsCount}✓
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[#6b6980]/25" title="Sin llamadas">
                  <Phone className="w-4 h-4" />
                </div>
              )}
              {(() => {
                const v = botIconVisual(hasBot ? botEstado : undefined);
                return (
                  <div className={cn("flex items-center gap-0.5 text-[11px] font-semibold", v.className)} title={v.title}>
                    <Bot className="w-4 h-4" />
                    {v.label}
                  </div>
                );
              })()}
              <div
                className={cn("flex items-center gap-1", cadenciaActiva ? "text-[#6b6980]" : "text-[#6b6980]/25")}
                title={cadenciaActiva ? "Seguimiento automático activo" : "Sin seguimiento activo"}
              >
                <AlarmClock className="w-4 h-4" />
              </div>
              <div
                className={cn("flex items-center gap-1", ventaMonto ? "text-emerald-600 dark:text-emerald-400" : "text-[#6b6980]/25")}
                title={ventaMonto ? `Venta ${money(ventaMonto)}` : "Sin venta registrada"}
              >
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="w-full mt-1">
            <button
              onClick={() => setAvanzarOpen(true)}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap px-4 py-2 w-full bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-white rounded-xl h-12 text-base font-medium shadow-md transition-all"
            >
              Avanzar
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mx-6 mt-4 bg-muted/50 p-1 rounded-[1rem] flex flex-wrap items-center justify-between border border-border/40 gap-1">
          {TABS.map(({ key, label, icon: Icon, disabled }) => (
            <button
              key={key}
              disabled={disabled}
              onClick={() => !disabled && setTab(key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 px-1 text-[11px] font-medium rounded-xl transition-all",
                disabled
                  ? "text-muted-foreground opacity-40 cursor-not-allowed"
                  : tab === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 relative overflow-hidden flex flex-col mt-4">
          {tab === "chat" && (
            <ChatTab
              key={name}
              contact={contact}
              ghlContactId={ghlContactId}
              role={role}
              onResolveIntervention={onResolveIntervention}
              hasBot={hasBot}
              botEstado={botEstado}
              onBotStateChange={handleBotStateChange}
              urgenteDetail={urgenteDetail}
              hasReplyTask={hasReplyTask}
              isCompletedToday={isCompletedToday}
              isPinned={isPinned}
              onPin={onPin}
              onComplete={onComplete}
              onRevive={onRevive}
            />
          )}
          {tab === "llamada" && <LlamadaTab llamadas={llamadas} />}
          {tab === "perfil" && <PerfilTab perfil={perfilFields} videoPreCall={videoPreCall} llamadas={llamadas} />}
          {tab === "historial" && <HistorialTab items={historial} />}
          {tab === "notas" && <NotasTab items={notas} onAdd={handleAddNota} />}
        </div>
      </div>

      {avanzarOpen && (
        <AvanzarModal role={role} name={name} onClose={() => setAvanzarOpen(false)} onConfirm={handleConfirmAvanzar} />
      )}
      <Celebration show={celebrate} />
      <Toast message={toast} />
    </>
  );
}

/* ---------- Chat ---------- */

const money2 = (n: number) => `$${n.toLocaleString("es-AR")}`;

function CatalogHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1.5 mt-4 first:mt-0">
      {children}
    </div>
  );
}

function CatalogItem({
  label,
  meta,
  icon: Icon = Link2,
  onClick,
}: {
  label: string;
  meta?: string;
  icon?: typeof CalendarClock;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between w-full px-2 py-1.5 rounded-md hover:bg-muted transition-colors text-left cursor-pointer"
    >
      <span className="flex items-center min-w-0">
        <Icon className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </span>
      {meta && <span className="text-xs text-muted-foreground shrink-0 ml-3">{meta}</span>}
    </button>
  );
}

interface ChatMessage {
  id: number;
  text: string;
  time: string;
  outgoing: boolean;
}

/** Cada cuánto se re-consulta a GHL mientras la vista está abierta (polling — mientras no haya tiempo real por webhooks). */
const POLL_MS = 10_000;

const SEED_MESSAGES: ChatMessage[] = [
  { id: 1, text: "Hola, quiero más info", time: "10:00 AM", outgoing: false },
  { id: 2, text: "¡Claro! ¿Te gustaría agendar una llamada?", time: "10:05 AM", outgoing: true },
];

/**
 * § "Sistema de completar tareas (toast + pin/FIJAR)", 2026-07-11 — reemplaza al viejo toggle
 * "mantener" del compositor. Barra delgada sobre el compositor tras responder una tarea de
 * conversación: verde con progreso que completa a los 5s; en hover se pausa, se pone ámbar con
 * ícono de pin, y un clic ahí FIJA la tarea en vez de completarla. Un solo componente para
 * Closer y Setter (comportamiento idéntico, §5 del doc).
 */
const TASK_COMPLETE_BAR_MS = 5000;

function TaskCompleteBar({ onDone }: { onDone: (fijado: boolean) => void }) {
  const [hovering, setHovering] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);

  useEffect(() => {
    if (hovering) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      elapsedRef.current += performance.now() - startRef.current;
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = elapsedRef.current + (now - startRef.current);
      const pct = Math.min(100, (elapsed / TASK_COMPLETE_BAR_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone(false);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovering]);

  const handleFijar = () => {
    if (!hovering || doneRef.current) return;
    doneRef.current = true;
    onDone(true);
  };

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={handleFijar}
      className={cn(
        "relative h-7 w-full shrink-0 overflow-hidden cursor-pointer select-none transition-colors",
        hovering ? "bg-amber-100 dark:bg-amber-900/30" : "bg-emerald-100 dark:bg-emerald-900/30",
      )}
    >
      <div
        className={cn("absolute inset-y-0 left-0", hovering ? "bg-amber-400/70 dark:bg-amber-500/40" : "bg-emerald-400 dark:bg-emerald-500/50")}
        style={{ width: `${progress}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
        {hovering ? (
          <span className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
            <Pin className="w-3.5 h-3.5" /> Fijar tarea
          </span>
        ) : (
          <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
        )}
      </div>
    </div>
  );
}

function ChatTab({
  contact,
  ghlContactId,
  role,
  onResolveIntervention,
  hasBot,
  botEstado,
  onBotStateChange,
  urgenteDetail,
  hasReplyTask,
  isCompletedToday,
  isPinned,
  onPin,
  onComplete,
  onRevive,
}: {
  contact?: ClosurerContact | null;
  /** contactId de GHL — si viene, se trae la conversación REAL (en vez del demo de Frank). */
  ghlContactId?: string | null;
  role: Role;
  onResolveIntervention?: () => void;
  /** IG no tiene bot (§11) — el toggle no se renderiza en absoluto. */
  hasBot: boolean;
  botEstado: BotEstado;
  onBotStateChange: (estado: BotEstado, evento: string, autor?: string) => void;
  urgenteDetail?: string;
  /** § toast/pin (2026-07-11): hay una tarea de Respondieron/Buzón/Oportunidad LT activa — responder dispara la barra de completado de 5s. */
  hasReplyTask?: boolean;
  isCompletedToday?: boolean;
  isPinned?: boolean;
  onPin?: () => void;
  onComplete?: () => void;
  onRevive?: () => void;
}) {
  const [message, setMessage] = useState("");
  // Con contactId de GHL arrancamos vacío y traemos la conversación REAL; sin él, el demo de Frank.
  const [messages, setMessages] = useState<ChatMessage[]>(ghlContactId ? [] : SEED_MESSAGES);
  const [convLoading, setConvLoading] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const { catalog, categorias, miCuenta } = useSettings();
  const [confirmDialog, setConfirmDialog] = useState<"apagar" | "normal" | "reforzada" | null>(null);
  const [hasSentManual, setHasSentManual] = useState(false);
  const [justActivated, setJustActivated] = useState(false);
  // § toast/pin (2026-07-11): barra de completado tras responder — reemplaza al viejo toggle "mantener".
  const [showCompleteBar, setShowCompleteBar] = useState(false);
  const prevBotEstado = useRef(botEstado);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastConvSigRef = useRef(""); // firma de la última conversación traída, para no re-renderizar si no cambió

  // § correcciones toast/pin v2 (bug 2): autofocus del compositor al abrir el tab Chat — solo desktop (§7 de CLAUDE.md), para no disparar el teclado virtual en mobile.
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) {
      textareaRef.current?.focus();
    }
  }, []);

  // Conversación REAL desde GHL cuando la ficha se abrió con un contactId (ej. una cita real).
  // Sin contactId, se conserva el demo de Frank (SEED_MESSAGES).
  // Polling cada POLL_MS mientras la ficha está abierta (hasta tener tiempo real por webhooks).
  useEffect(() => {
    if (!ghlContactId) return;
    let alive = true;
    const load = (first: boolean) => {
      if (first) setConvLoading(true);
      fetchConversation(ghlContactId)
        .then((res) => {
          if (!alive) return;
          const sig = res.messages.map((m) => `${m.id}:${m.text}`).join("|");
          if (sig !== lastConvSigRef.current) {
            lastConvSigRef.current = sig;
            setMessages(res.messages.map((m, i) => ({ id: i + 1, text: m.text, time: m.time, outgoing: m.outgoing })));
          }
        })
        .catch(() => {
          /* si falla, dejamos lo que había (no inventamos mensajes) */
        })
        .finally(() => {
          if (alive && first) setConvLoading(false);
        });
    };
    load(true);
    const iv = setInterval(() => load(false), POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [ghlContactId]);

  const isUrgente = botEstado === "pausado_fallo";
  const isDerivadoLt = botEstado === "derivado_lt";
  const isMuerto = botEstado === "muerto_postcall";
  const botOn = botEstado === "activo" || botEstado === "pausa_temporal";

  // Notificación desde el ícono del toggle cuando la IA se reactiva — manual O vía "Marcar como Resuelto".
  useEffect(() => {
    if (prevBotEstado.current !== "activo" && botEstado === "activo") {
      setJustActivated(true);
      const t = setTimeout(() => setJustActivated(false), 2200);
      prevBotEstado.current = botEstado;
      return () => clearTimeout(t);
    }
    prevBotEstado.current = botEstado;
  }, [botEstado]);

  const insertLink = (texto: string) => {
    setMessage((prev) => (prev ? `${prev}\n${texto}` : texto));
    setPlusOpen(false);
  };

  const handleBotToggle = () => {
    if (isUrgente || isMuerto) return;
    if (botOn) {
      setConfirmDialog("apagar");
    } else {
      setConfirmDialog(isDerivadoLt ? "reforzada" : "normal");
    }
  };

  const confirmToggle = () => {
    if (confirmDialog === "apagar") {
      onBotStateChange("apagado_manual", "IA apagada", "Usuario Activo");
    } else {
      onBotStateChange(
        "activo",
        confirmDialog === "reforzada" ? "IA reactivada (recuperada de low-ticket)" : "IA reactivada",
        "Usuario Activo",
      );
    }
    setConfirmDialog(null);
  };

  const handleSend = () => {
    const text = message.trim();
    if (!text) return;
    const time = new Date().toLocaleTimeString("es-AR", { hour: "numeric", minute: "2-digit" });
    setMessages((prev) => [...prev, { id: Date.now(), text, time, outgoing: true }]);
    setMessage("");
    if (isUrgente) {
      setHasSentManual(true);
    } else if (botEstado === "activo" && hasBot) {
      onBotStateChange("pausa_temporal", "IA en pausa temporal — mensaje manual detectado", "Sistema");
    }
    if (hasReplyTask) {
      // § correcciones toast/pin v2, bug 1: el completado se dispara AL ENVIAR — salir de la
      // conversación antes de que termine la barra ya no debe impedirlo. La barra de 5s que sigue
      // es solo la ventana visual para deshacer (FIJAR), no un requisito para completar.
      onComplete?.();
      setShowCompleteBar(true);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200">
      {isUrgente && (
        <div className="px-4 py-2.5 bg-rose-500/10 border-b border-rose-500/20 shrink-0">
          <p className="text-xs font-medium text-rose-700 dark:text-rose-400 flex items-start gap-1.5">
            <span className="shrink-0">⚠</span>
            <span>Intervención requerida. {urgenteDetail ?? "Responde al contacto para poder resolver."}</span>
          </p>
        </div>
      )}
      {isDerivadoLt && (
        <div className="px-4 py-2.5 bg-violet-500/10 border-b border-violet-500/20 shrink-0">
          <p className="text-xs font-medium text-violet-700 dark:text-violet-400 flex items-start gap-1.5">
            <span className="shrink-0">ℹ</span>
            <span>Derivado a low-ticket — el bot se pausó al derivar.</span>
          </p>
        </div>
      )}
      {isCompletedToday && onRevive && (
        <div className="px-4 py-2.5 bg-muted/50 border-b border-border/40 shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Tarea completada hoy.</p>
          <button
            onClick={onRevive}
            title="Simula que el contacto escribió de nuevo (demo — en producción lo dispara un mensaje entrante real)"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <RotateCcw className="w-3 h-3" /> Simular respuesta del contacto
          </button>
        </div>
      )}
      <div className="flex-1 p-4 bg-[#efeae2] dark:bg-[#0b141a] overflow-y-auto scrollbar-thin">
        <div className="space-y-2 flex flex-col pb-4">
          <div className="text-center my-2">
            <span className="text-[11px] font-medium text-[#54656f] dark:text-[#8696a0] bg-white/60 dark:bg-[#111b21]/60 px-3 py-1 rounded-lg shadow-sm">
              HOY
            </span>
          </div>
          {convLoading && (
            <div className="text-center text-xs text-[#54656f] dark:text-[#8696a0] py-4">Cargando conversación…</div>
          )}
          {!convLoading && ghlContactId && messages.length === 0 && (
            <div className="text-center text-xs text-[#54656f] dark:text-[#8696a0] py-4">Sin mensajes en esta conversación.</div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col max-w-[85%]", m.outgoing ? "self-end" : "self-start")}>
              <div
                className={cn(
                  "relative px-3 pt-1.5 pb-2 text-[14.5px] shadow-sm leading-relaxed break-words rounded-lg",
                  m.outgoing
                    ? "bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef] rounded-tr-none"
                    : "bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef] rounded-tl-none",
                )}
              >
                <span className="whitespace-pre-wrap">{m.text}</span>
                <span className="float-right text-[10px] text-black/40 dark:text-white/40 ml-3 mt-2">{m.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {isUrgente && (
        <button
          onClick={() => hasSentManual && onResolveIntervention?.()}
          disabled={!hasSentManual}
          className={cn(
            "w-full h-11 text-sm font-semibold shrink-0 border-t transition-colors",
            hasSentManual
              ? "bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-500 cursor-pointer"
              : "bg-muted text-muted-foreground border-border cursor-not-allowed",
          )}
        >
          {hasSentManual ? "Marcar como Resuelto" : "Responde al contacto para poder resolver"}
        </button>
      )}
      {showCompleteBar && (
        <TaskCompleteBar
          onDone={(fijado) => {
            setShowCompleteBar(false);
            // El completado ya ocurrió al enviar (handleSend) — fijar es lo único que queda por hacer acá, y deshace ese completado.
            if (fijado) onPin?.();
          }}
        />
      )}
      <div className="relative p-2 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border/30 shrink-0 flex items-end gap-1.5">
        {plusOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setPlusOpen(false)} />
            <div className="absolute bottom-full left-2 mb-2 w-72 max-h-80 overflow-y-auto scrollbar-thin bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-2 z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
              {categorias.map((categoria) => {
                const links = catalog.filter((l) => l.categoria === categoria && l.scope.includes(role));
                if (links.length === 0) return null;
                return (
                  <div key={categoria}>
                    <CatalogHeader>{categoria}</CatalogHeader>
                    {links.map((l) => (
                      <CatalogItem
                        key={l.id}
                        label={l.etiqueta}
                        meta={l.monto ? `${money2(l.monto)} · ${l.procesador}` : l.procesador}
                        onClick={() => insertLink(l.url)}
                      />
                    ))}
                  </div>
                );
              })}

              {contact?.agenda && (
                <div>
                  <CatalogHeader>Reagenda</CatalogHeader>
                  <CatalogItem
                    icon={CalendarClock}
                    label="Elegir horario yo"
                    onClick={() => insertLink("Te comparto nuevos horarios disponibles para reagendar tu llamada.")}
                  />
                  <CatalogItem
                    icon={Link2}
                    label="Que elija el contacto"
                    onClick={() => insertLink(`https://cal.example.com/reagendar/${contact.name.toLowerCase().replace(/\s+/g, "-")}`)}
                  />
                </div>
              )}

              <div>
                <CatalogHeader>Mi calendario</CatalogHeader>
                <CatalogItem
                  label="Mi link para agendar"
                  onClick={() => insertLink(miCuenta.linkPersonal)}
                />
              </div>

              {contact?.agenda && (
                <div>
                  <CatalogHeader>Videollamada</CatalogHeader>
                  <CatalogItem
                    icon={Video}
                    label="Link del Meet"
                    onClick={() => insertLink(`https://meet.google.com/${contact.name.toLowerCase().replace(/\s+/g, "-")}`)}
                  />
                </div>
              )}
            </div>
          </>
        )}
        {confirmDialog && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setConfirmDialog(null)} />
            <div className="absolute bottom-full right-2 mb-2 w-64 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-3 z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
              {confirmDialog === "apagar" ? (
                <>
                  <p className="text-sm font-medium mb-1">¿Desactivar agente IA?</p>
                  <p className="text-xs text-muted-foreground mb-3">El agente dejará de responder a este contacto.</p>
                </>
              ) : confirmDialog === "reforzada" ? (
                <>
                  <p className="text-sm font-medium mb-1">¿Devolver la conversación al agente HT?</p>
                  <p className="text-xs text-muted-foreground mb-3">Este contacto fue derivado a low-ticket. ¿Devolver la conversación al agente del camino high-ticket?</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium mb-1">¿Activar agente IA?</p>
                  <p className="text-xs text-muted-foreground mb-3">El bot retomará la conversación con este contacto.</p>
                </>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="h-8 px-3 rounded-full text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmToggle}
                  className={cn(
                    "h-8 px-3 rounded-full text-xs font-medium text-white",
                    confirmDialog === "apagar" ? "bg-slate-600 hover:bg-slate-700" : "bg-emerald-500 hover:bg-emerald-600",
                  )}
                >
                  Confirmar
                </button>
              </div>
            </div>
          </>
        )}
        <button
          onClick={() => setPlusOpen((v) => !v)}
          className="h-9 w-9 shrink-0 rounded-full text-[#54656f] dark:text-[#8696a0] hover:bg-black/5 dark:hover:bg-white/5 transition-all flex items-center justify-center mb-0.5"
        >
          <Plus className="w-6 h-6" />
        </button>
        <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-3xl flex items-end shadow-sm overflow-hidden min-h-[40px] mb-0.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Escribe un mensaje"
            className="w-full border-0 shadow-none focus-visible:outline-none resize-none min-h-[40px] max-h-[120px] py-2 px-4 text-[15px] bg-transparent leading-relaxed text-[#111b21] dark:text-[#d1d7db] placeholder:text-[#8696a0]"
          />
        </div>
        {message.trim() ? (
          <button
            onClick={handleSend}
            title="Enviar"
            className="h-10 w-10 shrink-0 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white transition-all flex items-center justify-center mb-0.5"
          >
            <Send className="w-5 h-5" />
          </button>
        ) : (
          <button className="h-10 w-10 shrink-0 rounded-full text-[#54656f] dark:text-[#8696a0] hover:bg-black/5 dark:hover:bg-white/5 transition-all flex items-center justify-center mb-0.5">
            <Mic className="w-6 h-6" />
          </button>
        )}
        {hasBot && !isMuerto && (
          <button
            onClick={handleBotToggle}
            disabled={isUrgente}
            title={botIconVisual(botEstado).title}
            className={cn(
              "relative h-10 w-10 shrink-0 rounded-full border transition-all flex items-center justify-center mb-0.5 ml-1",
              isUrgente
                ? "bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border-slate-200 dark:border-slate-700 cursor-not-allowed"
                : botOn
                  ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700",
            )}
          >
            <Bot className="w-5 h-5" />
            {botEstado === "pausa_temporal" && (
              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-amber-400 border-2 border-background" />
            )}
            {justActivated && (
              <span className="absolute bottom-full right-0 mb-2 whitespace-nowrap bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg pointer-events-none animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
                ✓ IA activada
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Llamadas (§ spec de Francisco, 2026-07-10) ---------- */

const CALL_ORIGIN_META: Record<CallOrigin, { label: string; icon: typeof Mic }> = {
  sales_call: { label: "Sales Call", icon: Mic },
  app_flow_voz: { label: "App Flow Voz", icon: Phone },
  lead_flow_voz: { label: "Lead Flow Voz", icon: Phone },
};

const SENTIMIENTO_META: Record<Sentimiento, { label: string; cls: string }> = {
  positivo: { label: "Positivo", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  neutral: { label: "Neutral", cls: "bg-muted text-muted-foreground" },
  negativo: { label: "Negativo", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

function CallCard({ call }: { call: CallRecord }) {
  const [open, setOpen] = useState(false);
  const meta = CALL_ORIGIN_META[call.origin];
  const isSalesCall = call.origin === "sales_call";
  const chipCls = isSalesCall
    ? "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20"
    : call.contestada
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
      : "bg-muted text-muted-foreground border-border";

  return (
    <div className="bg-muted/30 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide shrink-0", chipCls)}>
            <meta.icon className="w-3 h-3" />
            {meta.label}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {call.fecha} · {call.duracion}
            {call.resultado && <> · {call.resultado}</>}
          </span>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
          {isSalesCall ? (
            <>
              {call.scoreFinal !== undefined && (
                <div className="bg-background dark:bg-secondary rounded-xl border border-border/60 p-4 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Score Final</div>
                  <div className="text-3xl font-bold text-emerald-600">
                    {call.scoreFinal}
                    <span className="text-sm text-muted-foreground font-normal">/100</span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {call.objeciones && call.objeciones.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-rose-600 mb-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Objeciones
                    </div>
                    <div className="space-y-1.5">
                      {call.objeciones.map((o, i) => (
                        <div key={i} className="text-xs px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300">{o}</div>
                      ))}
                    </div>
                  </div>
                )}
                {call.puntosFuertes && call.puntosFuertes.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-emerald-600 mb-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Puntos Fuertes
                    </div>
                    <div className="space-y-1.5">
                      {call.puntosFuertes.map((p, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-foreground">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {p}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {call.aMejorar && call.aMejorar.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-amber-600 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> A Mejorar
                  </div>
                  <div className="space-y-1.5">
                    {call.aMejorar.map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-foreground">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {call.audioUrl && (
                <button className="w-full h-10 rounded-full border border-border flex items-center justify-center gap-2 text-sm font-medium hover:bg-muted transition-colors">
                  <PlayCircle className="w-4 h-4" /> Escuchar grabación
                </button>
              )}
            </>
          ) : call.contestada ? (
            <>
              {call.resumenIA && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Resumen de la IA</span>
                    {call.sentimiento && (
                      <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full", SENTIMIENTO_META[call.sentimiento].cls)}>
                        {SENTIMIENTO_META[call.sentimiento].label}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{call.resumenIA}</p>
                </div>
              )}
              {call.audioUrl && (
                <button className="w-full h-10 rounded-full border border-border flex items-center justify-center gap-2 text-sm font-medium hover:bg-muted transition-colors">
                  <PlayCircle className="w-4 h-4" /> Escuchar audio
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Sin conexión - Buzón de voz</p>
          )}
        </div>
      )}
    </div>
  );
}

function LlamadaTab({ llamadas }: { llamadas?: CallRecord[] }) {
  if (!llamadas || llamadas.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8 animate-in fade-in duration-200">
        <Phone className="w-12 h-12 text-muted-foreground/25" />
        <div>
          <p className="text-sm font-medium text-foreground">Sin registro de llamadas</p>
          <p className="text-xs text-muted-foreground mt-1">Las llamadas del agente de IA o del equipo de ventas aparecerán aquí.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 p-6 overflow-y-auto scrollbar-thin animate-in fade-in duration-200">
      <div className="space-y-3 max-w-2xl mx-auto">
        {llamadas.map((call) => (
          <CallCard key={call.id} call={call} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Perfil ---------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-4">
      <div className="col-span-1 text-[10px] uppercase tracking-wider text-muted-foreground pt-0.5">{label}</div>
      <div className="col-span-2 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

const PERFIL_GROUP_LABEL: Record<PerfilGroup, string> = {
  detalles: "Detalles del Contacto",
  origen: "Origen",
  calificacion: "Calificación",
  interacciones: "Interacciones",
};
const PERFIL_GROUP_ORDER: PerfilGroup[] = ["detalles", "origen", "calificacion", "interacciones"];

/** § Perfil — Form VSL/Meta (2026-07-16): mismo par de preguntas, campos DISTINTOS por formulario. */
const PERFIL_FORMULARIO_LABEL: Record<PerfilFormulario, string> = {
  vsl: "Form VSL",
  meta: "Form Meta",
};
const PERFIL_FORMULARIO_ORDER: PerfilFormulario[] = ["vsl", "meta"];

function PerfilFieldRow({ f }: { f: PerfilField }) {
  return (
    <Field label={f.label}>
      {f.value}
      {f.procedencia && <span className="text-xs text-muted-foreground font-normal"> · {f.procedencia}</span>}
    </Field>
  );
}

/**
 * § auditoría v2 (2026-07-11): el Perfil jala TODOS los campos con valor y los agrupa por
 * SIGNIFICADO, sin importar rol. Corrección (§ Perfil — Form VSL/Meta, 2026-07-16): DENTRO de
 * "Calificación" sí se distingue el formulario de origen — el lead form de Meta y el formulario de
 * la VSL escriben campos propios aunque la pregunta se parezca; un contacto puede tener llenos los
 * de Meta, los del VSL, o ambos. Un bloque sin datos muestra "Sin datos de este formulario" en vez
 * de desaparecer (a diferencia del resto de los grupos, que si están vacíos no se renderizan —
 * regla 10, §4 — acá la ausencia del BLOQUE es en sí misma información: ese lead nunca llenó ese
 * formulario). Mismo criterio aplicado a "Interacciones", que ahora suma Llamadas IA al Video pre-call.
 */
function PerfilTab({ perfil, videoPreCall, llamadas }: { perfil: PerfilField[]; videoPreCall?: VideoPreCallInfo; llamadas?: CallRecord[] }) {
  const iaCalls = callsIASummary(llamadas);
  const groups = PERFIL_GROUP_ORDER
    .map((group) => ({ group, fields: perfil.filter((f) => f.group === group) }))
    .filter(({ group, fields }) => fields.length > 0 || (group === "interacciones" && (videoPreCall || iaCalls.intentos > 0)));

  if (groups.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card text-center px-10">
        <UserCheck className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Sin datos de perfil todavía.</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200 bg-card">
      <div className="flex-1 p-6 overflow-y-auto scrollbar-thin">
        <div className="space-y-10 max-w-2xl mx-auto py-2">
          {groups.map(({ group, fields }) => (
            <div key={group}>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-6 border-b border-border/40 pb-2">
                {PERFIL_GROUP_LABEL[group]}
              </h3>

              {group === "calificacion" ? (
                <div className="space-y-6">
                  {PERFIL_FORMULARIO_ORDER.map((formulario) => {
                    const formFields = fields.filter((f) => f.formulario === formulario);
                    return (
                      <div key={formulario}>
                        <div className="text-[11px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-3">
                          {PERFIL_FORMULARIO_LABEL[formulario]}
                        </div>
                        {formFields.length > 0 ? (
                          <div className="space-y-4">
                            {formFields.map((f) => <PerfilFieldRow key={f.label} f={f} />)}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">Sin datos de este formulario.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  {fields.map((f) => <PerfilFieldRow key={f.label} f={f} />)}
                  {group === "interacciones" && videoPreCall && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-4">
                      <div className="col-span-1 text-[10px] uppercase tracking-wider text-muted-foreground pt-0.5">Video pre-call</div>
                      <div className="col-span-2">
                        {videoPreCall.visto ? (
                          <>
                            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{videoPreCall.pct}% visto</span>
                            <span className="text-xs text-muted-foreground"> · vía tracking{videoPreCall.fecha ? ` · ${videoPreCall.fecha}` : ""}</span>
                          </>
                        ) : (
                          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            Enviado · sin abrir{videoPreCall.diasSinAbrir ? ` hace ${videoPreCall.diasSinAbrir} días` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {group === "interacciones" && iaCalls.intentos > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-4">
                      <div className="col-span-1 text-[10px] uppercase tracking-wider text-muted-foreground pt-0.5">Llamadas IA</div>
                      <div className="col-span-2">
                        <span className="text-sm font-semibold text-foreground">{iaCalls.contestadas}</span>
                        <span className="text-sm text-muted-foreground"> contestadas de </span>
                        <span className="text-sm font-semibold text-foreground">{iaCalls.intentos}</span>
                        <span className="text-sm text-muted-foreground"> intentos</span>
                        {iaCalls.ultimoResultado && (
                          <div className="text-xs text-muted-foreground mt-0.5">Último resultado: {iaCalls.ultimoResultado}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Historial ---------- */
function HistorialTab({ items }: { items: HistorialItem[] }) {
  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200 bg-card">
      <div className="flex-1 p-8 overflow-y-auto scrollbar-thin">
        <div className="space-y-8 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px before:h-full before:w-px before:bg-gradient-to-b before:from-primary/30 before:via-border/50 before:to-transparent">
          {items.map((h, i) => (
            <div key={i} className="relative flex items-start gap-6 group">
              <div className="flex items-center justify-center w-6 h-6 rounded-full border-[3px] border-background bg-primary shrink-0 mt-0.5 shadow-sm z-10" />
              <div className="flex flex-col gap-1 w-full pb-2">
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.15em]">
                  {h.fecha} · {h.autor}
                </span>
                <div className="text-[14px] text-foreground font-medium leading-relaxed mt-1">{h.texto}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Notas ---------- */
function NotasTab({ items, onAdd }: { items: NotaItem[]; onAdd: (texto: string) => void }) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const texto = draft.trim();
    if (!texto) return;
    onAdd(texto);
    setDraft("");
  };

  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200 bg-card">
      <div className="flex-1 p-6 overflow-y-auto scrollbar-thin">
        <div className="space-y-4">
          {items.map((n) => (
            <div key={n.id} className="bg-muted/40 p-4 rounded-2xl text-sm border border-border/40 shadow-sm">
              <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                {n.contexto ? (
                  <>
                    junto a {n.contexto} · {n.autor}: "{n.texto}"
                  </>
                ) : (
                  n.texto
                )}
              </p>
              <p className="text-[10px] text-muted-foreground mt-3 text-right font-medium tracking-wide">{n.fecha}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 border-t border-border/50 bg-muted/10 shrink-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe una nueva nota..."
          className="flex w-full rounded-md border px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 min-h-[80px] text-sm resize-none border-border/50 focus-visible:ring-primary/30 mb-3 bg-background/50 dark:bg-secondary/50"
        />
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-5 rounded-full font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Plus className="w-4 h-4 mr-2" /> Nota
          </button>
        </div>
      </div>
    </div>
  );
}
