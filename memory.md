# memory.md — Registro de trabajo entre sesiones

**Requerimientos:** Agenda_citas.md
**Seguridad:** docs/SEGURIDAD-STACK.md — LECTOR OBLIGATORIO antes de escribir código (patrones prohibidos por CVE reales 2025-2026).

## Estado del proyecto

- Fase actual: diseño (brainstorming) — backend OdontoAgenda, repo nuevo, aún sin código.
- Decisión estructural: Opción A "espejo de SIARE" adaptado al dominio (C:\laragon\www\siare-inventario-actas).
- Stack fijado: Node 22 ESM, Fastify 5 (^5.12.6), TypeBox, Kysely (^0.29.8), pg, argon2, JWT + refresh cookie, node-pg-migrate (^9), node-cron (^4.6), Vitest. PostgreSQL LOCAL sin Docker (docker-compose solo para CI/deploy).
- Estructura: src/{config,core,db,http,modules,jobs,types}, módulos: auth, pacientes, servicios, agenda (horarios+bloqueos+config+disponibilidad), citas, recordatorios, reportes.
- Diseño aprobado: Sección 1 (arquitectura) y Sección 1.5 (seguridad del stack).
- Pendiente de aprobación: Sección 2 (modelo de datos: 8 tablas del plan + `sesiones` + `usuarios.nombre`), Sección 3 (endpoints), Sección 4 (disponibilidad/reserva), Sección 5 (seguridad app, pruebas, despliegue). Luego: spec en docs/superpowers/specs/ → plan de implementación (writing-plans).

## Notas clave

- INSTRUCCIÓN DEL USUARIO: no referenciar ni comparar con SIARE al presentar el diseño/código de este proyecto — se cruzan cosas y genera problemas. Solo consultar SIARE internamente si hace falta, nunca en entregables.

- SIARE solo tiene tests unitarios → aquí se reemplaza por unit + integración con PostgreSQL real (prueba de concurrencia EXCLUDE obliga).
- Nodemailer solo se agrega en etapa 5; floor ^9.0.1.
- Postgres servidor local debe ser 17.7+/18.1+ (CVE-2025-12818).
- Caída temporal de claude-mem: allowance exhausted; registrar avances aquí.
