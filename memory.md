# memory.md — Registro de trabajo entre sesiones

**Requerimientos:** Agenda_citas.md
**Seguridad:** docs/SEGURIDAD-STACK.md — LECTOR OBLIGATORIO antes de escribir código (patrones prohibidos por CVE reales 2025-2026).

## Estado del proyecto

- Fase actual: diseño (brainstorming) — backend OdontoAgenda, repo nuevo, aún sin código.
- Decisión estructural: Opción A "espejo de SIARE" adaptado al dominio (C:\laragon\www\siare-inventario-actas).
- Stack fijado: Node 22 ESM, Fastify 5 (^5.12.6), TypeBox, Kysely (^0.29.8), pg, argon2, JWT + refresh cookie, node-pg-migrate (^9), node-cron (^4.6), Vitest. PostgreSQL LOCAL sin Docker (docker-compose solo para CI/deploy).
- Estructura: src/{config,core,db,http,modules,jobs,types}, módulos: auth, pacientes, servicios, agenda (horarios+bloqueos+config+disponibilidad), citas, recordatorios, reportes.
- Diseño aprobado: Secciones 1, 1.5, 2, 3, 4 y 5 (en chat).
- Spec escrita y commiteada (repo git iniciado, commit afd1ba0): docs/superpowers/specs/2026-11-07-agenda-citas-backend-design.md. Auto-revisión hecha (matriz de roles añadida; generar recordatorios = solo admin; regla de recordatorios al cancelar/reprogramar).
- 2026-11-18: propietario aprueba continuar con lo pendiente antes de código → redactar plan de implementación (skill writing-plans), empezando por etapa 1.
- SIGUIENTE PASO: plan de implementación → aprobación del propietario → ejecutar etapa 1.

## Roadmap de Etapas del Proyecto

El proyecto tiene 7 etapas en orden (fuente: `Agenda_citas.md` §Etapas de desarrollo y `2026-11-07-agenda-citas-backend-design.md` §11):

| Etapa | Enfoque | Estado |
|-------|---------|--------|
| **1** | Base del proyecto | 🟡 En curso — 11 tasks pendientes, esperando aprobación propietario |
| **2** | Disponibilidad y reserva | 🔵 Por iniciar — requiere extensión EXCLUDE probada en Etapa 1 |
| **3** | Panel de administración | 🔵 Por iniciar — depende de la Etapa 2 (agenda funcionando) |
| **4** | Sitio público y portal del paciente | 🔵 Por iniciar — depende de disponibilidad y auth |
| **5** | Recordatorios, etapa 1 | 🔵 Por iniciar — job programado (node-cron) |
| **6** | Reportes y pulido | 🔵 Por iniciar — requiere datos reales de las etapas previas |
| **7** | Piloto y publicación | 🔵 Por iniciar — pruebas con consultorio real |

**Notas de dependencia:**
- La Etapa 2 (núcleo) es la más crítica: valida la restricción `EXCLUDE` de PostgreSQL y demuestra que no hay doble reserva.
- Las Etapas 3-4 comparten módulos (`agenda/`, `citas/`, `servicios/`) y pueden overlapped parcialmente.
- La Etapa 5 (recordatorios) depende de tener citas con estados `pendiente/confirmada` en la BD.
- La Etapa 6 es pulido final; la Etapa 7 es despliegue y validación en entorno real.

**Próximo hito:** aprobación del plan de Etapa 1 → ejecución tasks 1→11 → validación de la restricción EXCLUDE → pasar a Etapa 2.

## Notas clave

- INSTRUCCIÓN DEL USUARIO: no referenciar ni comparar con SIARE al presentar el diseño/código de este proyecto — se cruzan cosas y genera problemas. Solo consultar SIARE internamente si hace falta, nunca en entregables.

- SIARE solo tiene tests unitarios → aquí se reemplaza por unit + integración con PostgreSQL real (prueba de concurrencia EXCLUDE obliga).
- Nodemailer solo se agrega en etapa 5; floor ^9.0.1.
- Postgres servidor local debe ser 17.7+/18.1+ (CVE-2025-12818).
- Caída temporal de claude-mem: allowance exhausted; registrar avances aquí.
