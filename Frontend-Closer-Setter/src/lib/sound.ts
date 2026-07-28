import type { SonidoVenta } from "./settingsStore";

/**
 * Sonido de venta (§ Ajustes > Mi Cuenta, 2026-07-10) — sintetizado con Web Audio API.
 * No hay archivos de audio en el proyecto (frontend-only, sin backend); esto evita depender
 * de assets externos y mantiene el mismo sonido reproducible en cualquier navegador.
 */

let ctxSingleton: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!ctxSingleton) ctxSingleton = new AudioContext();
  if (ctxSingleton.state === "suspended") ctxSingleton.resume();
  return ctxSingleton;
}

function tone(ctx: AudioContext, freq: number, start: number, duration: number, gainPeak = 0.2) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainPeak, ctx.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

function noiseBurst(ctx: AudioContext, start: number, duration: number, gainPeak = 0.25) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainPeak, ctx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(ctx.currentTime + start);
  source.stop(ctx.currentTime + start + duration + 0.05);
}

function playCajaRegistradora(ctx: AudioContext) {
  tone(ctx, 880, 0, 0.12);
  tone(ctx, 1318.5, 0.1, 0.25);
}

function playAplausos(ctx: AudioContext) {
  [0, 0.09, 0.17, 0.24, 0.3].forEach((t) => noiseBurst(ctx, t, 0.08, 0.18));
}

export function playSaleSound(opt: SonidoVenta) {
  if (opt === "silencio") return;
  try {
    const ctx = getAudioContext();
    if (opt === "caja") playCajaRegistradora(ctx);
    else if (opt === "aplausos") playAplausos(ctx);
  } catch {
    // Web Audio no disponible (ej. entorno headless) — falla en silencio, no es crítico.
  }
}
