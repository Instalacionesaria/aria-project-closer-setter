import "dotenv/config";
import express from "express";
import cors from "cors";
import { agendaRouter } from "./routes/agenda";
import { startScheduler } from "./lib/scheduler";

const app = express();
app.use(express.json());

// CORS: solo los orígenes declarados en CORS_ORIGINS (frontend en Vercel + local).
const origins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));

// Healthcheck
app.get("/health", (_req, res) => res.json({ ok: true, service: "backend-closer-setter" }));

// API
app.use("/api", agendaRouter);

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`[backend-closer-setter] escuchando en http://localhost:${port}`);
  console.log(`[backend-closer-setter] CORS permitido: ${origins.join(", ") || "(todos)"}`);
  startScheduler(); // programa el análisis diario automático
});
