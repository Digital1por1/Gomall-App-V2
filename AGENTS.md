# Guía del repositorio

## Arquitectura

- Es una aplicación React 18 + Vite con un servidor Express escrito en TypeScript.
- `App.tsx` coordina la aplicación; las áreas de producto están en `components/` y el editor de reels en `components/reel/`.
- `server.ts` es la fuente del backend y `server.js` es la versión de producción registrada en Git. El script `build` actual sólo compila Vite: si cambia el backend, mantené ambos archivos sincronizados y verificá el runtime de producción.
- Firebase usa `firestore.rules` y `storage.rules`. Spec Kit vive en `.specify/` y sus skills de Claude en `.claude/skills/`.

## Flujo de trabajo

- Revisá `git status` y el diff existente antes de editar; preservá cambios ajenos a la tarea.
- Hacé cambios pequeños y localizados. Mantené TypeScript, componentes funcionales y el estilo del código circundante.
- Usá `.env.example` como base y mantené claves de Gemini, Firebase, Pexels y cuentas de servicio fuera de Git y del bundle del navegador.
- El lockfile está desincronizado con `package.json`. Hasta que una tarea autorice repararlo, instalá localmente con `npm install --ignore-scripts --package-lock=false` y no reescribas `package-lock.json` de forma incidental.
- Tratá despliegues, cambios de reglas remotas, migraciones y rotación de credenciales como acciones separadas que requieren una solicitud explícita.

## Comandos

- Instalación local sin reescribir el lockfile: `npm install --ignore-scripts --package-lock=false`
- Desarrollo: `npm run dev`
- Build del frontend: `npm run build`
- Lint declarado: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Producción local: `npm run start`

## Verificación

- Ejecutá `npm run build` después de cambios de frontend.
- `npm run lint` falla en la línea base porque el repositorio no contiene configuración de ESLint. `npx tsc --noEmit` es la validación estática disponible y actualmente pasa.
- No hay una suite de tests conectada a `package.json`; verificá manualmente los flujos afectados y las rutas API correspondientes.
- Conservá los marcadores `SPECKIT START` y `SPECKIT END` de `CLAUDE.md`; Spec Kit administra únicamente ese bloque.

<!-- claude-codex-project-setup:start -->
## Trabajo con Claude Code y Codex

- Antes de cambios amplios, leé [PROJECT.md](PROJECT.md) y [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md).
- `PROJECT.md` es la fuente canónica para propósito, arquitectura y comandos; este archivo conserva las reglas operativas.
- Preservá cualquier cambio existente, incluido el bloque administrado por Spec Kit, y entregá el trabajo sin commits ni publicación automática.
<!-- claude-codex-project-setup:end -->
