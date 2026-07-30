---
name: deploy
description: Despliega Comando Central a producción. En este repo desplegar es hacer push a `main` — la integración de GitHub con Vercel lo publica sola. Úsala cuando se pida desplegar, publicar, subir a producción, "actualizar la app", o tras terminar un cambio de frontend o de `api/`. Reemplaza al flujo con `vercel --prod`, que acá NO se usa.
---

# Deploy — Comando Central

**Desplegar es hacer `git push`. No se corre el CLI de Vercel.**

El repo `Instalacionesaria/aria-project-closer-setter` está conectado a Vercel
(`instalacionesariaia-1374s-projects/project-closer-setter`), así que Vercel buildea y
publica solo con cada push:

| Push a… | Qué pasa |
|---|---|
| **`main`** | Build → **producción**: https://project-closer-setter.vercel.app |
| **cualquier otra rama** | Build → **preview** con URL propia. Producción no se toca. |

Frontend y backend salen en el mismo deploy: `src/` compila a estáticos y `api/` se convierte
en Vercel Functions, bajo el mismo dominio (lo une el rewrite de `vercel.json`).

## No uses `vercel --prod`

Es lo que hacía la instrucción vieja de este repo y hoy es peligroso:

- Sube **la carpeta de trabajo**, no un commit. Publica lo que haya en disco, esté
  commiteado o no — y lo que subió puede no existir en ningún lado si después reseteás.
- Se saltea la integración de git, así que producción queda apuntando a algo que no
  corresponde a ningún commit de `main`. Rastrear qué está en vivo se vuelve imposible.
- El 2026-07-27 casi tira producción abajo con esto: se corrió desde una carpeta con la
  estructura vieja del repo y el build no incluía `api/`, o sea que dejaba el backend entero
  en 404. Se alcanzó a borrar el deployment antes de que se aliaseara.

El único caso legítimo del CLI es `vercel deploy` (sin `--prod`) para un preview suelto sin
pushear. Para publicar, siempre push.

## Antes de pushear a `main`

Este repo es compartido — Kevin y su colega pushean a `main`, y **cualquier merge a `main`
publica sin paso intermedio de confirmación**. Así que:

1. **Traer lo del otro primero.** Un `main` desactualizado puede pisar trabajo ajeno o
   desplegar con una estructura vieja:
   ```bash
   git fetch origin && git rev-list --left-right --count HEAD...origin/main
   ```
   Si hay commits atrás, **parar y mirar qué cambió** — puede ser la estructura del repo, no
   solo código.

2. **Build y tests limpios.** No se pushea a mitad de una edición:
   ```bash
   npm run build && npm test
   ```
   Los tests del colega (91) tienen que seguir pasando; romperlos es romper su trabajo.

3. **Si el cambio no está acordado, no va a `main`.** Pushear a una rama da un preview con
   URL propia para revisar sin publicar:
   ```bash
   git push -u origin mi-rama
   ```
   Ojo: los previews tienen la protección de Vercel activada — se abren en un navegador
   logueado en Vercel, no con `curl`.

## Verificar después

El deploy tarda ~30s. Para confirmar que producción está sirviendo el commit nuevo, comparar
el hash del bundle contra el build local — si coinciden, subió:

```bash
curl -s https://project-closer-setter.vercel.app/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
ls dist/assets/*.js
```

Y probar los endpoints que tocó el cambio, p. ej.:

```bash
curl -s https://project-closer-setter.vercel.app/api/closer/mi-dia
```

Nota: producción devuelve **403 intermitente** a `curl` de vez en cuando (el challenge de
bots del edge de Vercel), incluso en endpoints sanos. Reintentar antes de diagnosticar nada.

## Lo que un deploy NO arregla

Si el cambio depende de algo de esto, pushear no alcanza y hay que decirlo explícitamente en
vez de dar el trabajo por terminado:

- **Variables de entorno** — se agregan con `vercel env add <NOMBRE> production` y **solo
  entran en el build siguiente**. Las `VITE_*` se hornean en el bundle: sin redeploy, el
  navegador no las ve.
- **Migraciones de base** — los `.sql` de `docs/db/` los aplica una persona en Supabase.
  Ningún push crea una tabla.
- **Workflows de GHL** — los webhooks los configura Francisco del lado de GoHighLevel. El
  endpoint puede estar desplegado y nunca recibir un evento.
- **Saldo de Anthropic** — sin créditos, las analizadoras degradan en silencio (devuelven
  sin marcar nada) aunque el código esté arriba.

## Si el CLI hace falta igual

Para env vars, logs o inspección — no para publicar. Si `vercel whoami` da "Not authorized",
pedirle al usuario `! vercel login` (es interactivo). Un **"Failed to save consent"** en el
navegador NO significa que falló: verificar con `vercel whoami` antes de reintentar.
