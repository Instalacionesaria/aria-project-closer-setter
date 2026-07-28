/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del backend (Backend-Closer-Setter en la VPS). Ej. https://api.tu-dominio.com */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
