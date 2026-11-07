# Seguridad del stack — patrones prohibidos y obligatorios

> **Para futuras sesiones:** lector obligatorio antes de escribir código de este proyecto.
> Basado en advisories documentados 2025–2026 (CVE/GHSA) investigados el 2026-11-07.
> Regla: si un método aparece aquí como PROHIBIDO, no se usa aunque compile y pase tests.

## 1. Versiones mínimas (floor de seguridad)

| Paquete | Floor | Motivo |
|---|---|---|
| fastify | ^5.12.6 | 10 advisories 2026 (5 High) parchados en 5.8.5–5.12.6 |
| @fastify/jwt | ^10.2.5 | CVE-2026-18500 (High), GHSA-9x4w-r9p5-5h7m, CVE-2026-110024 |
| @fastify/cookie | ^11 (latest) | — |
| kysely | ^0.29.8 | 4 SQLi High 2026 vía JSON-path / sql.lit, parchados |
| pg | ^8 (latest) | sin CVEs conocidos |
| argon2 | ^0.45.2 | sin CVEs conocidos |
| node-cron | ^4.6.0 | sin CVEs; usar el nombre EXACTO (existen typosquats maliciosos: node-cron-master) |
| node-pg-migrate | ^9.0.0 | 8.x arrastraba High transitivo en glob viejo |
| nodemailer (etapa 5) | ^9.0.1 | CVE-2026-82854 (Crítica), CVE-2026-82659 (High), serie DoS |
| PostgreSQL servidor | 17.7+ / 18.1+ | CVE-2025-12818 (libpq/servidor) |

## 2. PROHIBIDO (por paquete)

### fastify
- ❌ `trustProxy` numérico (hop-count) — spoofing de `X-Forwarded-*` (CVE-2026-16732, CVE-2026-3635).
  ✅ Dev: `trustProxy: false`. Prod (detrás de proxy): función que valida `socket.remoteAddress` contra el rango del proxy.
- ❌ Body schemas primitivos en la raíz (ej. `body: Type.Integer()`) — el handler recibe el valor sin coercionar (CVE-2026-18504).
  ✅ Siempre `Type.Object({...})`.
- ❌ Schemas booleanos (`body: false`) como "deny-all" — se saltaban por completo (CVE-2026-84469).
- ❌ Validadores `$async` que devuelven `{ value, error }` — colisión de body (CVE-2026-84504). Si algún día hay validador custom: que **throw**, no devuelva error.
- ❌ Header schemas con `dependencies` o `propertyNames` como mecanismo de seguridad — normalización de mayúsculas incompleta (CVE-2026-84428, CVE-2026-107832). Si hay que exigir/limitar headers: hook `onRequest`/`preValidation`.
- ❌ Habilitar HTTP/2 o `reply.trailer()` (DoS CVE-2026-92081). ❌ Streaming de respuestas junto a `handlerTimeout` (GHSA-3qgw-9275-xf8w).

### @fastify/jwt
- ❌ `expiresIn` / `maxAge` como **string** (`"15m"`, `"1h30m"`) — si el span no se parsea, el token **nace sin `exp` y nunca expira** (GHSA-9x4w-r9p5-5h7m).
  ✅ SIEMPRE número de **segundos** (ej. `900`, `604800`).
- ❌ Keys por-request (`request.jwtVerify({ verify: { key } })`) — el secreto global las sobrescribía → bypass (CVE-2026-18500).
  ✅ Un único secreto global para access tokens.
- ❌ `fastify.jwt.sign/verify` top-level con opciones por-call para lógica de seguridad (CVE-2026-110024). Usar decoradores `request.jwtVerify()` / `reply.jwtSign()`.

### kysely
- ❌ `Kysely<any>` en código de aplicación — desactiva la verificación de tipos que protege contra inyección.
- ❌ `.key()` / `.at()` (JSON paths) con input de usuario, y `sql.lit()` con input de usuario (familia CVE-2026-32763 / -33442 / -33468 / -44635).
  ✅ Este esquema **no tiene columnas JSON**; si algún día se agregan, los path legs se tratan como datos estructurados con allowlist, nunca strings interpolados.
- ✅ SQL crudo solo con `sql\`\`` y parámetros ligados; cero concatenación.

### nodemailer (etapa 5)
- ❌ Opción `raw` con paths/URLs derivados de input de usuario — lectura de archivos/SSRF (CVE-2026-82659).
  ✅ Siempre `disableFileAccess: true` y `disableUrlAccess: true` en el transport.
- ❌ `envelope.size` o `name` del transport derivados de input (inyección SMTP por CRLF: CVE-2026-82854, GHSA-vvjj).
  ✅ Destinatarios solo desde la BD; `from`/`name` fijos en configuración.

### argon2
- ❌ `argon2.verify()` sobre strings que no generó el propio servicio — un hash con parámetros de coste maliciosos es un arma DoS (lección Directus GHSA-xw72-c69j-h2rj).
  ✅ Verificar solo hashes de nuestra tabla `usuarios`; parámetros de coste fijos; rate limit en login (5/min).

### node-cron
- ❌ Paquetes con nombres parecidos (`node-cron-master`, `cron-guru`… = malware confirmado MAL-2022).

## 3. OBLIGATORIO (infraestructura)

- `package-lock.json` comprometido; CI instala con `npm ci` (nunca `npm install`).
- Gate de CI: `npm audit --omit=dev --audit-level=high` → **rompe el build** si falla.
- Dependabot semanal: npm + GitHub Actions.
- Revisar advisories del ecosistema fastify cada trimestre (en 2026 sacaron ~1 advisory/mes).
- Cookies de sesión: `httpOnly`, `secure` en prod, `sameSite: strict`, path restringido a `/api/v1/auth`.
- Refresh tokens guardados SOLO como hash (sha256) en `sesiones`; el token claro jamás toca la BD ni los logs.

## 4. Referencias principales

CVE-2026-33806, CVE-2026-84469, CVE-2026-84428, CVE-2026-84504, CVE-2026-18504, CVE-2026-16732, CVE-2026-92081 (fastify) · CVE-2026-18500, GHSA-9x4w-r9p5-5h7m, CVE-2026-110024 (@fastify/jwt) · CVE-2026-32763, CVE-2026-33442, CVE-2026-33468, CVE-2026-44635 (kysely) · CVE-2026-82854, CVE-2026-82659 (nodemailer) · CVE-2025-12818 (PostgreSQL) · GHSA-xw72-c69j-h2rj (lección argon2/Directus) · CVE-2025-29744 (lección pg-promise → parametrizar siempre).

> Nota: SIARE usa `@fastify/jwt ^10.1.0` (rango afectado por CVE-2026-18500; no explotable con su patrón actual, pero actualizar a ^10.2.5).
