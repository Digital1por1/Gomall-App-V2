# Gomall App V2

<!-- claude-codex-project-setup:start -->
## Propósito

Herramienta para crear contenido publicitario y administrar recursos de marca, campañas y piezas multimedia para socios de Gomall.

## Arquitectura verificable

- Cliente React 18 construido con Vite.
- `App.tsx` coordina la aplicación; las áreas de producto viven en `components/` y el editor de reels en `components/reel/`.
- `server.ts` es la fuente TypeScript del backend Express y `server.js` es la versión de producción registrada en Git.
- Firebase ofrece servicios de aplicación; las reglas versionadas están en `firestore.rules` y `storage.rules`.
- Spec Kit vive en `.specify/` y sus skills para Claude Code en `.claude/skills/`.

## Comandos declarados

- Desarrollo: `npm run dev`
- Build del frontend: `npm run build`
- Lint: `npm run lint`
- Preview o producción local: `npm run preview` o `npm run start`
- Typecheck documentado: `npx tsc --noEmit`

El script `build` sólo compila el frontend. No existe un script de tests en `package.json`.

## Documentación

- [README.md](README.md): descripción e instalación actualmente documentadas.
- [AGENTS.md](AGENTS.md): reglas operativas para agentes.
- [CLAUDE.md](CLAUDE.md): entrada de Claude Code y contexto de Spec Kit.
- [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md): coordinación entre Claude Code y Codex.

## Límites

Los despliegues, cambios de reglas remotas, migraciones, remotos Git y publicación requieren autorización explícita y separada.

## Por confirmar

- Reparación y política canónica del lockfile antes de volver a usar una instalación reproducible.
- Configuración canónica de ESLint; el script está declarado pero actualmente no tiene configuración en el repositorio.
- Procedimiento para mantener sincronizados `server.ts` y `server.js` cuando cambia el backend.
- Estrategia de pruebas automatizadas del proyecto.
<!-- claude-codex-project-setup:end -->
