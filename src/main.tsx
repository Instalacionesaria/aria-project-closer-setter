import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { temaCacheado } from "./lib/authStore";
import "./index.css";

/**
 * El tema, antes del primer render.
 *
 * Tiene que pasar acá y no dentro de un `useEffect`: un efecto corre DESPUÉS de pintar, así que
 * quien usa el modo oscuro vería un fogonazo blanco en cada recarga. La preferencia de verdad
 * vive en la fila del usuario y la trae `/api/auth/sesion`; esto solo lee la copia local para
 * que el primer frame ya salga bien. Si difieren, gana el servidor.
 */
if (temaCacheado() === "oscuro") document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
