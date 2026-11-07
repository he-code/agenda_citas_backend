# Agenda de citas para consultorio odontológico: plan del proyecto

Nov 6, 2026 · @Henry

## Resumen

Un sitio web para un consultorio odontológico de un solo profesional: muestra los servicios, permite que los pacientes se registren y agenden, y da al consultorio un panel para manejar la agenda.

El problema real es que hoy las citas se agendan según la disponibilidad del profesional, por libreta, llamada o WhatsApp. Eso produce choques de horario, citas olvidadas e inasistencias.

En el portafolio demuestra cuatro cosas: cálculo de disponibilidad, control de concurrencia en la base de datos, roles y tareas programadas, y recordatorios por WhatsApp, todo probado con un usuario real.

## Alcance del MVP

El MVP cubre tres áreas: el sitio público, el portal del paciente y el panel de administración. Todo lo que no esté aquí se considera fuera de alcance.

**Sitio público**

- Inicio, servicios (con duración y precio referencial), sobre el doctor, contacto y ubicación.
- Botón "Agendar cita" que lleva al registro o inicio de sesión.

**Paciente (con cuenta)**

- Registro e inicio de sesión.
- Elegir servicio, ver los horarios disponibles y reservar.
- Ver sus citas, y cancelar o reprogramar hasta un límite de horas antes.

**Administración (odontólogo y recepción)**

- Agenda del día y de la semana.
- Cambiar el estado de una cita: confirmar, atendida, no asistió o cancelada.
- Agendar manualmente a quien llama o llega al consultorio, sin que tenga cuenta.
- Gestionar servicios, horarios de atención y bloqueos (vacaciones, feriados, emergencias).
- Lista "Citas de mañana" con botón de recordatorio por WhatsApp.
- Reportes simples: citas por mes, tasa de inasistencia y servicios más pedidos.

**Fuera del MVP**

- Historia clínica y odontograma: son datos sensibles y otro proyecto.
- Pagos en línea.
- Envío automático por la API de WhatsApp (etapa 2, opcional).
- Varios profesionales o varios consultorios en una misma instalación.

## Reglas de negocio

La regla central: una sola agenda para todos los canales, y la base de datos impide que dos citas ocupen el mismo horario.

1. **Una sola agenda.** Las citas de la web y las que recepción registra por teléfono o en persona viven en el mismo sistema. Si el doctor sigue con una libreta aparte, habrá choques de horario.
2. **Disponibilidad calculada, no guardada.** Los horarios libres salen de: horarios de atención, menos bloqueos, menos citas pendientes o confirmadas, ajustados a la duración del servicio elegido.
3. **Sin doble reserva.** La restricción `EXCLUDE` de PostgreSQL rechaza cualquier cita que se solape con otra pendiente o confirmada, aunque dos personas reserven a la vez. Los bloqueos se validan en la misma transacción.
4. **Confirmación configurable.** El ajuste `confirmacion_automatica` define el flujo:
   - Con aprobación (recomendado para empezar): la cita nace `pendiente`, ya ocupa el horario y recepción la confirma con un clic. Si nadie la aprueba en `horas_limite_aprobacion`, se libera.
   - Automática: la cita nace `confirmada`.
5. **Cancelación y reprogramación.** El paciente puede hacerlo hasta `horas_min_cancelacion` antes de la cita. Después, solo recepción.
6. **Estados de la cita.** `pendiente`, `confirmada`, `atendida`, `cancelada` y `no_asistio`. Solo las dos primeras ocupan horario.
7. **Pacientes sin cuenta.** Recepción los registra con nombre y teléfono (el teléfono es obligatorio). Si después crean cuenta, se vincula a su ficha por cédula o teléfono.
8. **Zona horaria.** Todo se guarda en UTC y se muestra en `America/Guayaquil`.
9. **Datos personales.** Se piden solo los datos necesarios y se muestra un aviso de privacidad al registrarse, en línea con la normativa ecuatoriana de protección de datos personales. Conviene confirmar los detalles con una fuente legal antes de usar datos reales.

## Modelo de datos

Ocho tablas en PostgreSQL. La pieza clave es la restricción `EXCLUDE` de `citas`, que necesita la extensión `btree_gist`.

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
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('paciente','admin','recepcion')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pacientes (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT UNIQUE REFERENCES usuarios(id),  -- NULL si no tiene cuenta
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  cedula TEXT UNIQUE,
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
);  -- varias filas por día permiten pausa de almuerzo

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

Dos decisiones de diseño que conviene explicar en el README:

- Los bloqueos no pueden entrar en el `EXCLUDE` porque están en otra tabla, así que se validan dentro de la misma transacción que crea la cita.
- Al cancelar, la cita no se borra: cambia a `cancelada` y libera el horario, para conservar el historial y las estadísticas de inasistencia.

## Stack y arquitectura

El stack reutiliza lo que ya dominas en tus otros proyectos, para que el esfuerzo vaya a la lógica de agenda y no a aprender herramientas nuevas. El frontend consume una API REST y la API es la única que habla con PostgreSQL.

| Capa | Tecnología | 1. Por qué |
| --- | --- | --- |
| Base de datos | PostgreSQL | Necesaria para `EXCLUDE` con rangos de tiempo |
| API | Node.js, TypeScript, Fastify, TypeBox | Misma base que SIARE |
| Autenticación | JWT con refresh tokens y roles | Ya implementado en SIARE |
| Frontend | Vue 3, Vite, Pinia | Misma base que SIARE |
| Tareas programadas | `node-cron` o `pg-boss` | Generar recordatorios y liberar citas sin aprobar |
| Correo | Nodemailer con un proveedor SMTP | Canal secundario |
| WhatsApp, etapa 1 | Enlace `wa.me` con mensaje prellenado | Sin costo ni verificación |
| WhatsApp, etapa 2 | API de WhatsApp Business (Meta) | Envío automático; revisar costos y requisitos vigentes |
| Pruebas | Vitest, más una prueba de concurrencia | Demuestra que no hay doble reserva |
| Entorno | Docker Compose y GitHub Actions | Cualquiera puede levantarlo con un comando |
| Despliegue | Railway (API y base) y Vercel (frontend) | Mismo flujo que tus proyectos actuales |

## Etapas de desarrollo

Siete etapas en orden. El núcleo técnico (etapa 2) va antes que las pantallas, porque es lo que más valor demuestra y lo más difícil de corregir después.

1. **Base del proyecto.** Repositorio, Docker Compose con PostgreSQL, migraciones, datos de ejemplo (servicios y horarios), autenticación y roles.
   - Terminado cuando: hay login con roles y pruebas que verifican qué puede hacer cada rol.
2. **Disponibilidad y reserva.** Endpoint que calcula los horarios libres y creación de citas en una transacción con la restricción `EXCLUDE`.
   - Terminado cuando: una prueba lanza dos reservas simultáneas para el mismo horario y solo una prospera.
3. **Panel de administración.** Agenda diaria y semanal, cambio de estados, agendado manual para pacientes sin cuenta, gestión de servicios, horarios y bloqueos, y el ajuste de confirmación automática o con aprobación.
   - Terminado cuando: recepción puede llevar toda una jornada de citas sin tocar la base de datos.
4. **Sitio público y portal del paciente.** Páginas de servicios y contacto, registro, reserva de citas, "Mis citas" y cancelación o reprogramación con la regla de horas mínimas.
   - Terminado cuando: un paciente nuevo reserva desde el celular en menos de tres minutos.
5. **Recordatorios, etapa 1.** Tarea programada que prepara los recordatorios del día siguiente y lista "Citas de mañana" con botón de WhatsApp; correo opcional.
   - Terminado cuando: recepción envía todos los recordatorios del día en pocos minutos.
6. **Reportes y pulido.** Citas por mes, tasa de inasistencia y servicios más pedidos; validaciones, mensajes de error claros, vista móvil y aviso de privacidad.
   - Terminado cuando: los reportes coinciden con los datos de prueba y no hay pantallas rotas en móvil.
7. **Piloto y publicación.** Prueba con un consultorio real durante unas semanas, ajustes según lo que pase, despliegue y documentación.
   - Terminado cuando: el consultorio lo usó con citas reales y hay al menos un número antes y después, por ejemplo la inasistencia.

Extensión opcional, después de todo lo anterior: envío automático por la API de WhatsApp Business.

