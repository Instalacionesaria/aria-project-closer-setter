import { useState } from "react";
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
} from "lucide-react";
import { cn } from "../lib/utils";

type DrawerTab = "chat" | "llamada" | "perfil" | "historial" | "notas";

const TABS: { key: DrawerTab; label: string; icon: typeof X; disabled?: boolean }[] = [
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "llamada", label: "Llamada", icon: PhoneCall, disabled: true },
  { key: "perfil", label: "Perfil", icon: UserCheck },
  { key: "historial", label: "Historial", icon: History },
  { key: "notas", label: "Notas", icon: MessageSquareText },
];

export default function ContactDrawer({ name, onClose }: { name: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<DrawerTab>("chat");
  if (!name) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200"
      />
      {/* Sheet */}
      <div className="fixed z-50 inset-y-0 right-0 h-full border-l w-full sm:max-w-[540px] p-0 flex flex-col border-l-border/20 bg-[#f5f5f7] dark:bg-[#000000] shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="pt-8 px-6 pb-6 bg-background/80 backdrop-blur-2xl border-b border-border/30 shrink-0 z-10 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-2xl font-bold tracking-tight text-foreground truncate">{name}</h2>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="inline-flex items-center border font-semibold px-2.5 py-1 rounded-md text-[11px] truncate uppercase tracking-wider cursor-pointer hover:opacity-80 transition-opacity bg-cyan-50 text-cyan-700 border-cyan-200/60 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30">
                Venta LT — Masterclass
              </div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-muted text-muted-foreground">
                -
              </div>
              <div className="flex items-center gap-1 text-[#6b6980]" title="Agendado">
                <Calendar className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1 text-[#6b6980]/25" title="Sin llamadas">
                <Phone className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1 text-[#6b6980]/25 cursor-not-allowed" title="IA no disponible después de la llamada de ventas">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1 text-[#6b6980]/25">
                <AlarmClock className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1 text-[#6b6980]/25">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="w-full mt-1">
            <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap px-4 py-2 w-full bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-white rounded-xl h-12 text-base font-medium shadow-md transition-all">
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
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 relative overflow-hidden flex flex-col mt-4">
          {tab === "chat" && <ChatTab />}
          {tab === "perfil" && <PerfilTab />}
          {tab === "historial" && <HistorialTab />}
          {tab === "notas" && <NotasTab />}
        </div>
      </div>
    </>
  );
}

/* ---------- Chat ---------- */
function ChatTab() {
  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200">
      <div className="flex-1 p-4 bg-[#efeae2] dark:bg-[#0b141a] overflow-y-auto scrollbar-thin">
        <div className="space-y-2 flex flex-col pb-4">
          <div className="text-center my-2">
            <span className="text-[11px] font-medium text-[#54656f] dark:text-[#8696a0] bg-white/60 dark:bg-[#111b21]/60 px-3 py-1 rounded-lg shadow-sm">
              HOY
            </span>
          </div>
          <div className="flex flex-col max-w-[85%] self-start">
            <div className="relative px-3 pt-1.5 pb-2 text-[14.5px] shadow-sm leading-relaxed break-words bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef] rounded-lg rounded-tl-none">
              <span>Hola, quiero más info</span>
              <span className="float-right text-[10px] text-black/40 dark:text-white/40 ml-3 mt-2">10:00 AM</span>
            </div>
          </div>
          <div className="flex flex-col max-w-[85%] self-end">
            <div className="relative px-3 pt-1.5 pb-2 text-[14.5px] shadow-sm leading-relaxed break-words bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef] rounded-lg rounded-tr-none">
              <span>¡Claro! ¿Te gustaría agendar una llamada?</span>
              <span className="float-right text-[10px] text-black/40 dark:text-white/40 ml-3 mt-2">10:05 AM</span>
            </div>
          </div>
        </div>
      </div>
      <div className="p-2 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border/30 shrink-0 flex items-end gap-1.5">
        <button className="h-9 w-9 shrink-0 rounded-full text-[#54656f] dark:text-[#8696a0] hover:bg-black/5 dark:hover:bg-white/5 transition-all flex items-center justify-center mb-0.5">
          <Plus className="w-6 h-6" />
        </button>
        <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-3xl flex items-end shadow-sm overflow-hidden min-h-[40px] mb-0.5">
          <textarea
            rows={1}
            placeholder="Escribe un mensaje"
            className="w-full border-0 shadow-none focus-visible:outline-none resize-none min-h-[40px] max-h-[120px] py-2 px-4 text-[15px] bg-transparent leading-relaxed text-[#111b21] dark:text-[#d1d7db] placeholder:text-[#8696a0]"
          />
        </div>
        <button className="h-10 w-10 shrink-0 rounded-full text-[#54656f] dark:text-[#8696a0] hover:bg-black/5 dark:hover:bg-white/5 transition-all flex items-center justify-center mb-0.5">
          <Mic className="w-6 h-6" />
        </button>
        <button className="h-10 w-10 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center mb-0.5 ml-1">
          <AlarmClock className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/* ---------- Perfil ---------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-4">
      <div className="col-span-1 text-xs text-muted-foreground pt-0.5">{label}</div>
      <div className="col-span-2 text-sm font-medium">{children}</div>
    </div>
  );
}

function PerfilTab() {
  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200 bg-background">
      <div className="flex-1 p-6 overflow-y-auto scrollbar-thin">
        <div className="space-y-10 max-w-2xl mx-auto py-2">
          <div>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-6 border-b border-border/40 pb-2">
              Detalles del Contacto
            </h3>
            <div className="space-y-4">
              <Field label="Teléfono">54 911 3333 4444</Field>
              <Field label="Correo">valentina.gomez@ejemplo.com</Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-4">
                <div className="col-span-1 text-xs text-muted-foreground pt-0.5">Categoría</div>
                <div className="col-span-2 text-sm font-medium flex items-center gap-2">
                  <span className="bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 px-1.5 py-0.5 rounded text-[10px] font-bold">
                    Segmento -
                  </span>
                  <span className="text-muted-foreground text-xs">Requiere nutrición a largo plazo</span>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-6 border-b border-border/40 pb-2">
              Formulario Llamada
            </h3>
            <div className="space-y-5">
              <Field label="¿Cuál es tu principal desafío actual?">
                Conseguir propiedades en exclusiva de forma predecible.
              </Field>
              <Field label="¿Cuánto estás invirtiendo en publicidad (Meta/Google) al mes?">
                $500 - $1,000 USD
              </Field>
              <Field label="¿Cuántas propiedades captas en promedio mensual?">1 a 2 propiedades.</Field>
              <Field label="¿Trabajas solo o tienes un equipo?">Soy agente independiente.</Field>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Historial ---------- */
const HISTORIAL = [
  { fecha: "27 Jun", texto: "Interacción inicial con IA" },
  { fecha: "27 Jun", texto: "Agendó llamada de ventas" },
];

function HistorialTab() {
  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200 bg-background">
      <div className="flex-1 p-8 overflow-y-auto scrollbar-thin">
        <div className="space-y-8 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px before:h-full before:w-px before:bg-gradient-to-b before:from-primary/30 before:via-border/50 before:to-transparent">
          {HISTORIAL.map((h, i) => (
            <div key={i} className="relative flex items-start gap-6 group">
              <div className="flex items-center justify-center w-6 h-6 rounded-full border-[3px] border-background bg-primary shrink-0 mt-0.5 shadow-sm z-10" />
              <div className="flex flex-col gap-1 w-full pb-2">
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.15em]">
                  {h.fecha}
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
function NotasTab() {
  return (
    <div className="absolute inset-0 flex flex-col animate-in fade-in duration-200 bg-background">
      <div className="flex-1 p-6 overflow-y-auto scrollbar-thin">
        <div className="space-y-4">
          <div className="bg-muted/40 p-4 rounded-2xl text-sm border border-border/40 shadow-sm">
            <p className="text-foreground whitespace-pre-wrap leading-relaxed">
              junto a Venta LT · Setter: "Compró la masterclass para empezar"
            </p>
            <p className="text-[10px] text-muted-foreground mt-3 text-right font-medium tracking-wide">
              9 jul, 02:05
            </p>
          </div>
        </div>
      </div>
      <div className="p-4 border-t border-border/50 bg-muted/10 shrink-0">
        <textarea
          placeholder="Escribe una nueva nota..."
          className="flex w-full rounded-md border px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 min-h-[80px] text-sm resize-none border-border/50 focus-visible:ring-primary/30 mb-3 bg-background/50"
        />
        <div className="flex justify-end">
          <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-5 rounded-full font-medium transition-colors">
            <Plus className="w-4 h-4 mr-2" /> Nota
          </button>
        </div>
      </div>
    </div>
  );
}
