import Anthropic from "@anthropic-ai/sdk";
import type { GhlMessage } from "./ghl";

// Lee ANTHROPIC_API_KEY del entorno automáticamente.
const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

/** Los 5 criterios de "la IA no atendió bien" (definidos por Francisco/Kevin, 2026-07). */
const RUBRICA = `Eres un auditor de calidad de un agente de IA que atiende conversaciones de ventas por WhatsApp/chat.
Tu tarea: determinar si la IA NO atendió bien al usuario, según estos criterios:

1. El usuario se frustró o se enojó y la IA no lo manejó.
2. La IA dejó de responder o ignoró al usuario.
3. La IA prometió algo incorrecto o se contradijo.
4. El usuario dijo que no es lo que busca.
5. El usuario insiste en algo y la IA no lo entiende.

Si ocurre AL MENOS UNO de estos, la conversación "falló" y requiere intervención humana.
Si NINGUNO ocurre, no falló.

Sé estricto pero justo: NO marques fallo por cosas normales (el usuario preguntando, negociando,
pidiendo info, o la IA respondiendo correctamente). En la conversación, "USUARIO" es el contacto/lead
y "IA" es el agente automático.

Responde ÚNICAMENTE con un JSON válido, sin texto adicional, con esta forma exacta:
{"fallo": true|false, "criterio": "frustracion"|"dejo_de_responder"|"promesa_incorrecta"|"no_es_lo_que_busca"|"insiste_no_entiende"|"ninguno", "motivo": "explicación breve en español"}`;

export interface Verdict {
  fallo: boolean;
  criterio: string;
  motivo: string;
}

/** Arma el transcript cronológico (GHL devuelve más reciente primero). Acota a los últimos 40 mensajes para controlar tokens. */
export function buildTranscript(messages: GhlMessage[]): string {
  const chrono = [...messages]
    .filter((m) => m.body && !(m.messageType ?? "").startsWith("TYPE_ACTIVITY"))
    .reverse();
  const last = chrono.slice(-40);
  return last
    .map((m) => `${m.direction === "inbound" ? "USUARIO" : "IA"}: ${(m.body ?? "").trim()}`)
    .join("\n");
}

/** Extrae el primer objeto JSON de un texto (por si el modelo agrega algo alrededor). */
function parseVerdict(text: string): Verdict {
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : "{}";
  const obj = JSON.parse(raw);
  return {
    fallo: Boolean(obj.fallo),
    criterio: typeof obj.criterio === "string" ? obj.criterio : "ninguno",
    motivo: typeof obj.motivo === "string" ? obj.motivo : "",
  };
}

/** Evalúa una conversación con Claude contra la rúbrica. */
export async function evaluateConversation(messages: GhlMessage[]): Promise<Verdict> {
  const transcript = buildTranscript(messages);
  if (!transcript.trim()) {
    return { fallo: false, criterio: "ninguno", motivo: "Sin mensajes de texto para evaluar." };
  }
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: RUBRICA,
    messages: [{ role: "user", content: `Conversación a auditar:\n\n${transcript}` }],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  return parseVerdict(text);
}
