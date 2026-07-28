# Regla: desplegar a Vercel tras cada cambio

**Después de completar un cambio en el FRONTEND, desplegar a producción en Vercel con el CLI — sin esperar a que se pida explícitamente.** Autorización permanente del usuario (2026-07-16).

## Qué desplegar y cómo

- Aplica **solo a `Frontend-Closer-Setter/`** (es lo que vive en Vercel). El **backend (`Backend-Closer-Setter/`) NO va a Vercel** — corre en la VPS del usuario; sus cambios se despliegan aparte allá.
- Comando (desde la carpeta del frontend):
  ```bash
  cd Frontend-Closer-Setter && vercel --prod
  ```
- Cuenta/Team correcto: **`instalacionesariaia-1374s-projects`** · Proyecto: **`project-closer-setter`** · Prod: https://project-closer-setter.vercel.app
- Root Directory del proyecto en Vercel = `Frontend-Closer-Setter` (el `.vercel/` ya vive en esa carpeta).

## Condiciones antes de desplegar (no deployear a ciegas)

1. Desplegar solo cuando el cambio esté **completo** y **`npm run build` pase limpio** (no a mitad de una edición).
2. Si el cambio toca **solo el backend**, **no** desplegar a Vercel (ese cambio va a la VPS).
3. Si `vercel whoami` falla (token expirado), pedir al usuario `! vercel login` — no intentar autenticar de otra forma.
4. Reportar la URL del deployment al terminar.

## Notas

- El `vercel` CLI puede estar desactualizado; está bien, funciona igual (o sugerir `npm i -g vercel@latest`).
- Ver también CLAUDE.md §49 (misma regla, contexto de producto) y la memoria [[como-trabajar-comando-central]] / [[monorepo-backend-ghl]].
