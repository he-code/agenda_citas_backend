# Diseño — API backend "Agenda de citas" para consultorio odontológico

Fecha: 2026-11-07 · Estado: aprobado por el propietario del proyecto (secciones 1–5 en chat)
Requerimientos fuente: `Agenda_citas.md` · Seguridad de dependencias: `docs/SEGURIDAD-STACK.md`

## 1. Propósito y criterios de éxito

API REST para la agenda de citas de un consultorio odontológico de un solo profesional. El sitio público y los portales (frontend Vue 3, repos aparte) solo consumen esta API; esta API es la única que habla con PostgreSQL.

El problema que resuelve: hoy las citas se agendan por libreta, llamada o WhatsApp según la disponibilidad mental del profesional → choques de horario, citas olvidadas, inasistencias. Regla central: **una sola agenda para todos los canales, y la base de datos impide que dos citas ocupen el mismo horario**.

Criterios de éxito (portafolio + uso real):

1. Cálculo de disponibilidad correcto y probado (horarios − bloqueos − citas, ajustado al servicio).
2. Sin doble reserva aunque dos personas reserven a la vez — demostrado con prueba de concurrencia contra PostgreSQL real.
3. Roles funcionando y probados (paciente / recepcion / admin).
4. Tareas programadas: recordatorios del día siguiente y liberación de reservas no aprobadas.
5. Recordatorios por WhatsApp etapa 1 (enlace `wa.me` con mensaje prellenado; la API registra el envío).
6. Un consultorio real lo usa con citas reales (etapa 7 del plan).

## 2. Alcance

**Dentro (MVP)**: API para sitio público (servicios), portal del paciente (registro, disponibilidad, reserva, mis citas, cancelar/reprogramar con límite de horas) y panel de administración (agenda día/semana, estados, agendado manual sin cuenta, servicios, horarios, bloqueos, configuración, recordatorios, reportes simples).

**Fuera de alcance**: historia clínica y odontograma, pagos en línea, API oficial de WhatsApp Business (etapa 2 opcional futura), múltiples profesionales o consultorios por instalación, email automático (Nodemailer se incorpora como canal secundario en etapa 5).

## 3. Stack y versiones

Node.js 22 (ESM) · TypeScript estricto · Fastify ^5.12.6 · @sinclair/typebox ^0.34 · Kysely ^0.29.8 sobre pg ^8 · argon2 ^0.45.2 · @fastify/jwt ^10.2.5 · @fastify/cookie/cors/helmet/rate-limit/swagger (latest 11–13) · node-pg-migrate ^9.0.0 · node-cron ^4.6.0 · nodemailer ^9.0.1 (etapa 5) · Vitest · ESLint + Prettier · Docker Compose + GitHub Actions · Railway (API + PostgreSQL) y Vercel (frontend).

PostgreSQL servidor ≥ 17.7 / 18.1 (CVE-2025-12818). Versiones floor obligatorias y patrones prohibidos: ver `docs/SEGURIDAD-STACK.md` (lector obligatorio antes de escribir código).

## 4. Arquitectura y estructura

```
src/
  config/env.ts              # env validada: DATABASE_URL, secretos JWT, CORS, TZ, flags cron, seed
  core/
    errors.ts                # AppError { code, statusCode, message, details? }
    roles.ts                 # roles, estados de cita, orígenes
    pagination.ts            # helpers de listas paginadas
    tiempo.ts                # localToUtc / utcToLocal / formatoLocal con Intl (America/Guayaquil)
  db/
    database.ts              # pool pg + instancia Kysely (PostgresDialect)
    types.ts                 # interfaz Database de las 9 tablas (sin any)
  http/
    auth-guard.ts            # authenticate + requireRole(...roles)
    schemas.ts               # esquemas comunes (ids, paginación, rangos de fecha)
  modules/
    auth/                    # registro público, login, refresh con rotación, logout, me
    pacientes/               # búsqueda, ficha, edición, vinculación por cédula/teléfono
    servicios/               # lista pública, CRUD admin (soft delete)
    agenda/                  # horarios de atención, bloqueos, configuración + cálculo de disponibilidad
    citas/                   # reserva transaccional, estados, cancelar/reprogramar, agenda día/semana
    recordatorios/           # generar (cron o manual), lista mañana, marcar enviado
    reportes/                # citas por mes, inasistencia, servicios más pedidos
  jobs/
    scheduler.ts             # node-cron: recordatorios diarios + liberación de pendientes (30 min)
  types/fastify.d.ts         # tipado de request.user
  app.ts                     # buildApp(): plugins, swagger, error handler central, rutas /api/v1
  server.ts                  # escucha + arranca scheduler (fuera de app.ts: los tests no corren cron)
migrations/                  # node-pg-migrate (up/down)
scripts/seed.ts              # configuración, servicios, horarios, usuarios admin/recepción de ejemplo
tests/                       # unitarias + integración + concurrencia + matriz de roles
```

Convenciones por módulo: `X.routes.ts` (validación TypeBox + rutas + guards) + `X.service.ts` (lógica). `agenda` posee el cálculo de disponibilidad (disponibles = horarios − bloqueos − citas); `citas` lo importa al reservar. Errores: envelope `{ error: { code, message, details?, requestId } }`; éxito `{ data }`. Swagger UI en `/docs`, tags por módulo.

## 5. Modelo de datos (9 tablas, PostgreSQL)

UTC en todos los `timestamptz`; las columnas `TIME` de `horarios_atencion` son hora local del consultorio (`America/Guayaquil`, sin DST desde 1992). Las 8 tablas de `Agenda_citas.md` se respetan tal cual; se agregan `sesiones` y `usuarios.nombre`.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE configuracion (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- una sola fila
  nombre_consultorio TEXT NOT NULL,
  confirmacion_automatica BOOLEAN NOT NULL DEFAULT false,
  horas_min_cancelacion INT NOT NULL DEFAULT 12,
  horas_limite_aprobacion INT NOT NULL DEFAULT 24,
  duracion_slot_min INT NOT NULL DEFAULT 15
);

CREATE TABLE usuarios (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,             -- argon2id, parámetros fijos del servidor
  nombre TEXT NOT NULL,                    -- adición: display de admin/recepción
  rol TEXT NOT NULL CHECK (rol IN ('paciente','admin','recepcion')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sesiones (                    -- adición: rotación/detección de reuso de refresh
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,         -- sha256; NUNCA el token en claro
  ip TEXT,
  user_agent TEXT,
  expira_en TIMESTAMPTZ NOT NULL,
  revocada_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sesiones_usuario ON sesiones (usuario_id);

CREATE TABLE pacientes (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT UNIQUE REFERENCES usuarios(id),  -- NULL si no tiene cuenta
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  cedula TEXT UNIQUE,                      -- múltiples NULL permitidos
  telefono TEXT NOT NULL,
  email TEXT,
  fecha_nacimiento DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE servicios (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  duracion_min INT NOT NULL CHECK (duracion_min > 0),
  precio_ref NUMERIC(8,2),
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE horarios_atencion (
  id BIGSERIAL PRIMARY KEY,
  dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL CHECK (hora_fin > hora_inicio)
);

CREATE TABLE bloqueos (
  id BIGSERIAL PRIMARY KEY,
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ NOT NULL CHECK (fin > inicio),
  motivo TEXT
);

CREATE TABLE citas (
  id BIGSERIAL PRIMARY KEY,
  paciente_id BIGINT NOT NULL REFERENCES pacientes(id),
  servicio_id BIGINT NOT NULL REFERENCES servicios(id),
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ NOT NULL CHECK (fin > inicio),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','confirmada','atendida','cancelada','no_asistio')),
  origen TEXT NOT NULL CHECK (origen IN ('web','recepcion')),
  notas TEXT,
  creada_por BIGINT REFERENCES usuarios(id),
  cancelada_en TIMESTAMPTZ,
  motivo_cancelacion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  EXCLUDE USING gist (tstzrange(inicio, fin) WITH &&)
    WHERE (estado IN ('pendiente','confirmada'))
);
CREATE INDEX idx_citas_inicio ON citas (inicio);
CREATE INDEX idx_citas_paciente ON citas (paciente_id);

CREATE TABLE recordatorios (
  id BIGSERIAL PRIMARY KEY,
  cita_id BIGINT NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp_manual','whatsapp_api','email')),
  programado_para TIMESTAMPTZ NOT NULL,
  enviado_en TIMESTAMPTZ,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','enviado','error'))
);
```

Reglas asociadas: cancelar **no borra** la fila (cambia estado y libera horario). Los bloqueos no pueden entrar al `EXCLUDE` (otra tabla) → se validan en la misma transacción de la cita. `configuracion` de una sola fila.

Migraciones node-pg-migrate (con `up`/`down`): `001_base` (extensión + configuracion + usuarios + sesiones), `002_agenda` (pacientes, servicios, horarios_atencion, bloqueos), `003_citas` (citas con EXCLUDE + recordatorios + índices).

## 6. API (prefijo /api/v1)

Roles: P = paciente, R = recepcion, A = admin, + = autenticado, pub = público.

| Método y ruta | Roles | Notas |
|---|---|---|
| POST /auth/registro | pub | usuario(paciente)+paciente en una transacción; `acepto_privacidad` obligatorio; si `cedula`/`telefono` matchean ficha sin cuenta → vincula, no duplica; rate limit 5/min |
| POST /auth/login | pub | rate limit 5/min; refresh en cookie httpOnly |
| POST /auth/refresh | + | rotación; reuso detectado → revoca todas las sesiones del usuario |
| POST /auth/logout · GET /auth/me | + | |
| GET /servicios · GET /servicios/:id | pub | solo activos (sitio público) |
| POST /servicios · PATCH /servicios/:id · DELETE /servicios/:id | A | DELETE = desactivar (soft) |
| GET /agenda/horarios | R,A · PUT A | PUT reemplaza la semana completa (rangos con pausa de almuerzo) |
| GET /agenda/bloqueos · POST · DELETE /agenda/bloqueos/:id | GET R,A · resto A | POST rechaza si solapa citas pendientes/confirmadas → 409 con lista |
| GET /agenda/configuracion | + · PATCH A | incluye `confirmacion_automatica` |
| GET /agenda/disponibilidad?fecha&servicioId | + | cálculo de la sección 7 |
| POST /citas | P (sí, origen web) · R,A (pacienteId, origen recepcion) | reserva transaccional; permite ficha sin cuenta |
| GET /citas?fecha&desde&hasta&estado | R,A | agenda día/semana |
| GET /citas/mias | P | "Mis citas" |
| GET /citas/:id | dueño o R,A | |
| POST /citas/:id/confirmar · /atendida · /no-asistio | R,A | transiciones explícitas |
| POST /citas/:id/cancelar | P propia con límite · R,A siempre | motivo requerido; `CANCELACION_TARDIA` si excede |
| POST /citas/:id/reprogramar | P propia con límite · R,A | UPDATE inicio/fin misma fila, EXCLUDE re-valida |
| GET /pacientes?q&pagina · GET/PATCH /pacientes/:id | R,A | búsqueda nombre/cédula/teléfono |
| POST /recordatorios/generar | A | cron diario llama al mismo servicio (etapa 5) |
| GET /recordatorios/manana | R,A | citas de mañana + teléfono + estado recordatorio |
| POST /recordatorios/:id/enviado | R,A | marca `enviado_en` (el enlace wa.me lo arma el frontend) |
| GET /reportes/citas-por-mes · /inasistencia · /servicios-mas-pedidos | A | etapa 6 |
| GET /health | pub | check de BD |

Códigos de error del dominio: `SLOT_TAKEN` (409, captura 23P01), `SOLAPA_BLOQUEO` (409), `FUERA_DE_HORARIO` (400), `CITA_EN_PASADO` (400), `CANCELACION_TARDIA` (409), `SERVICIO_INACTIVO` (400), más los genéricos (`VALIDATION_ERROR`, `DUPLICATE_VALUE`, etc.).

## 7. Reglas críticas

**Disponibilidad** (`agenda/disponibilidad.service.ts`, función pura + consulta):
1. `fecha` local → ventana UTC del día. 2. Rangos de `horarios_atencion` del `dia_semana` → instantes UTC. 3. Ocupaciones: bloqueos + citas `pendiente|confirmada` (`tstzrange &&`), fusionadas. 4. Resta de intervalos. 5. Rejilla con paso `duracion_slot_min` desde el inicio de cada rango; slot válido si `inicio + servicio.duracion_min` cabe. 6. Fuera los pasados. 7. Respuesta con `inicioUtc` + `inicioLocal` (ISO con zona).

**Reserva** (una transacción):
1. Servicio activo → `fin = inicio + duracion_min`. 2. Checks en transacción: no pasado · dentro de horario · sin solape con bloqueos. 3. Estado inicial: `confirmacion_automatica ? 'confirmada' : 'pendiente'` (ambos ocupan horario). 4. INSERT; si otro proceso ganó el hueco, PostgreSQL lanza `23P01` → 409 `SLOT_TAKEN`. El `EXCLUDE` es la única garantía real; los checks solo mejoran el mensaje.

**Cancelación / reprogramación**: paciente dueño hasta `horas_min_cancelacion` antes (staff siempre); reprogramar = `UPDATE inicio/fin` en transacción (mismas validaciones; EXCLUDE re-valida; conserva historial).

**Liberación de no aprobadas** (decisión registrada): job cada 30 min cancela `pendiente` cuya **edad** supere `horas_limite_aprobacion` (`created_at + horas_limite_aprobacion < now()`), motivo `no_aprobada_a_tiempo`. (Lectura alternativa — liberar cuando faltan X horas para la cita — descartada: anularía reservas legítimas hechas con anticipación.)

**Recordatorios** (etapa 5): job diario genera `whatsapp_manual` para citas de mañana sin recordatorio; recepción envía por enlace `wa.me` y la API registra `enviado_en`. La lista "citas de mañana" se construye desde citas (join con recordatorios), por lo que un recordatorio de cita cancelada jamás se muestra. Al **cancelar** una cita, sus recordatorios `pendiente` pasan a `error`; al **reprogramar**, si la cita ya no es de mañana el recordatorio queda sin efecto por la misma regla de la lista.

**Zona horaria**: helpers de `core/tiempo.ts` con `Intl` (sin dependencias); guardar UTC, mostrar `America/Guayaquil`.

## 8. Seguridad de aplicación

**Matriz de roles** (probada endpoint por endpoint en la suite):

| Acción | paciente | recepcion | admin |
|---|:-:|:-:|:-:|
| Reservar para sí, "mis citas", cancelar/reprogramar dentro del límite | ✅ | — | — |
| Agenda día/semana, confirmar/atendida/no-asistio, agendar sin cuenta, pacientes, lista y envío de recordatorios | — | ✅ | ✅ |
| Gestión de servicios, horarios, bloqueos, configuración, generar recordatorios, reportes | — | — | ✅ |

- **Tokens**: access 900 s, refresh 604 800 s — **números de segundos, nunca strings**. Un solo secreto global; sin keys por-request; `exp` obligatorio. Cookie httpOnly/secure(prod)/sameSite strict/path `/api/v1/auth`.
- **Rate limits**: global 120/min · login 5/min · registro 5/min · refresh 10/min.
- **Contraseñas**: argon2id con parámetros fijos; mínimo 8 caracteres; nunca `verify()` sobre hashes que no generó el servicio.
- **Permisos**: `requireRole(...)` en cada ruta; un paciente jamás accede a fichas ajenas.
- **Datos personales (regla 9)**: mínimo necesario; consentimiento explícito en registro; logs con redacción de credenciales/cookies; errores sin stack ni SQL.
- **Patrones prohibidos** (fastify/jwt/kysely/nodemailer/argon2/cron): ver `docs/SEGURIDAD-STACK.md` — documento vinculante.
- **Infra**: `trustProxy` false en dev, función validadora del rango del proxy en prod; CORS allowlist; helmet; bodyLimit 1 MB; `npm audit --omit=dev --audit-level=high` como gate de CI; Dependabot semanal; `npm ci` con lockfile.

## 9. Pruebas (Vitest)

| Tipo | Alcance | Infra |
|---|---|---|
| Unitarias | función pura de disponibilidad, regla de cancelación tardía, vinculación, helpers de tiempo | sin BD |
| Integración | endpoints reales: auth por rol, reserva con EXCLUDE, bloqueos, cancelar/reprogramar, recordatorios | `TEST_DATABASE_URL`; migraciones up antes de la suite; TRUNCATE entre tests |
| Concurrencia | 2 reservas simultáneas del mismo slot → 1 gana, 1 recibe 409 | `Promise.all` contra BD real |
| Matriz de roles | cada endpoint protegido × 3 roles | automatizada |

Cobertura alta en el núcleo (disponibilidad, citas); sin perseguir 100% global.

## 10. Despliegue

Local: PostgreSQL instalado ≥17.7, `.env` (`DATABASE_URL`, secretos), `npm run db:migrate` + `npm run db:seed` + `npm run dev`. Contenedores: `Dockerfile` multi-stage (node:22-slim) y `docker-compose.yml` con PostgreSQL 17 (CI / un comando). CI (GitHub Actions): `npm ci` → typecheck → lint → tests (servicio postgres 17) → build → audit gate. Producción: Railway (API + PostgreSQL gestionado; migraciones como release step) y Vercel (frontend, repo aparte). `.env.example` documentado; secretos jamás en el repo.

## 11. Etapas de implementación

1. Base: repo, herramienta de migraciones, 9 tablas, seed, auth (registro/login/refresh/logout/me) + matriz de roles probada.
2. Núcleo: disponibilidad + reserva transaccional + prueba de concurrencia (terminado cuando la prueba simultánea deja un solo ganador).
3. Administración: agenda día/semana, estados, agendado manual, servicios, horarios, bloqueos, configuración.
4. Paciente: endpoints de reserva propia, mis citas, cancelar/reprogramar con límite.
5. Recordatorios: job diario + lista mañana + marcar enviado (+ email opcional).
6. Reportes y pulido: 3 reportes, validaciones, mensajes, aviso de privacidad.
7. Piloto y publicación: consultorio real, ajustes, despliegue, documentación.

## 12. Decisiones registradas

| # | Decisión | Justificación |
|---|---|---|
| 1 | Estructura espejo adaptada al dominio (aprobada) | Reutilizar patrones probados; esfuerzo en la lógica de agenda |
| 2 | node-pg-migrate ^9 con up/down | Elección del propietario; reemplaza runners hechos a mano |
| 3 | PostgreSQL local sin Docker para desarrollo | Elección del propietario; docker-compose queda para CI/terceros |
| 4 | Tabla `sesiones` (9ª) + `usuarios.nombre` | La rotación de refresh exige persistencia; admin/recepción necesitan nombre visible |
| 5 | Sin `audit_logs` en MVP | `citas` ya registra `creada_por`, `cancelada_en`, `motivo_cancelacion`; se agrega en etapa 6 si hace falta |
| 6 | Disponibilidad autenticada (no pública) | No exponer la agenda completa del doctor a anónimos |
| 7 | `horas_limite_aprobacion` por edad de la reserva | Lectura alternativa anularía reservas legítimas con anticipación |
| 8 | Acciones explícitas en vez de PATCH estado genérico | Guard y mensaje propios por transición; legible en Swagger |
| 9 | Nodemailer recién en etapa 5 | Email es canal secundario; floor ^9.0.1 por CVE-2026-82854/82659 |
| 10 | Seguridad de dependencias documentada y vinculante | `docs/SEGURIDAD-STACK.md`; advisories reales 2025–2026 investigados |
