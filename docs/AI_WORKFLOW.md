# Flujo de trabajo con agentes

<!-- claude-codex-project-setup:start -->
## Fuentes de verdad

1. La solicitud actual del usuario define alcance y autorizaciones.
2. `AGENTS.md` contiene las reglas operativas del repositorio.
3. `PROJECT.md` describe propósito, arquitectura y comandos canónicos.
4. Este documento define la coordinación entre Claude Code y Codex.
5. El bloque de Spec Kit en `CLAUDE.md` aporta contexto del plan activo sin reemplazar estas reglas compartidas.

## Antes de editar

- Revisar `git status` y el diff existente.
- Identificar qué cambios ya estaban presentes y preservarlos.
- Acordar qué agente es responsable de cada ruta; dos agentes no deben editar el mismo archivo simultáneamente.
- Separar cualquier acción remota o destructiva del trabajo local.

## Durante el trabajo

- Mantener los cambios dentro del alcance solicitado.
- No usar reset, checkout, stash ni limpieza para resolver un worktree sucio sin autorización explícita.
- Mantener credenciales y datos sensibles fuera de documentación, salida y control de versiones.
- Conservar los marcadores administrados por Spec Kit y por esta configuración.

## Validación

- Documentación: revisar enlaces relativos y ejecutar `git diff --check`.
- Código: usar los comandos declarados en `PROJECT.md` y distinguir fallas preexistentes de regresiones.
- Cambios de Firebase o servicios externos: validar localmente cuando exista una herramienta segura; los entornos remotos quedan fuera del flujo normal.

## Entrega

- Resumir archivos modificados, verificaciones y pendientes.
- Dejar los cambios sin commit ni push salvo solicitud explícita.
- Tratar migraciones, despliegues, remotos Git, publicación y rotación de credenciales como tareas separadas.
<!-- claude-codex-project-setup:end -->
