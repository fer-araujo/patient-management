# Despliegue en Vercel

Guía paso a paso para publicar la aplicación en Vercel. La aplicación es una
SPA (React + Vite) que habla directamente con Supabase; Vercel solo sirve los
archivos estáticos de `dist/`.

Toda la configuración de Vercel vive en `vercel.json` (framework, comando de
build, carpeta de salida, reescrituras de rutas, caché y cabeceras de
seguridad). No hace falta cambiar nada de eso en el panel de Vercel.

## Antes de empezar

- Una cuenta de Vercel con acceso al repositorio de GitHub.
- Acceso de administración al proyecto de Supabase de producción.
- La URL del proyecto de Supabase y su clave **anon** (Supabase → Project
  Settings → API).

## 1. Crear el proyecto en Vercel

### Opción A: desde el panel (recomendada)

1. Vercel → **Add New… → Project** → importar el repositorio.
2. **Framework Preset**: Vite (se detecta solo; `vercel.json` lo fija de todos
   modos).
3. **Root Directory**: la raíz del repositorio.
4. **Build Command** y **Output Directory**: dejar los valores por defecto;
   `vercel.json` los fija en `npm run build` y `dist`.
5. Antes de pulsar **Deploy**, cargar las variables de entorno del paso 2.

### Opción B: con la CLI

```bash
npm i -g vercel
vercel login
vercel link                 # vincula la carpeta con el proyecto (crea .vercel/, ya ignorada por git)
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel --prod               # despliega a producción
```

## 2. Variables de entorno

En **Settings → Environment Variables**, entorno **Production**:

| Variable                 | Valor                                       |
| ------------------------ | ------------------------------------------- |
| `VITE_SUPABASE_URL`      | `https://<referencia-del-proyecto>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | la clave `anon` / `public` del proyecto     |

Puntos importantes:

- Las variables `VITE_*` se **incrustan en el JavaScript público** durante el
  build. Cualquiera puede leerlas desde el navegador.
- La clave **anon es pública por diseño**: lo que protege los datos son las
  políticas RLS de Supabase, no el secreto de esa clave.
- **NUNCA** cargar la clave `service_role` en Vercel. Esa clave ignora RLS; si
  se publicara, cualquier persona tendría acceso total a la base de datos.
- Cambiar una variable no afecta al despliegue actual: hay que **volver a
  desplegar** (Deployments → último despliegue → **Redeploy**).

## 3. Rama de producción

**Settings → Git → Production Branch**: `master`. Solo lo que llega a `master`
se publica en el dominio de producción.

## 4. Despliegues de vista previa (preview): advertencia

Vercel crea por defecto un despliegue de vista previa por cada rama y cada
pull request, con una URL pública. **Esos despliegues usan el mismo proyecto de
Supabase** (las mismas variables), así que, una vez entregada la aplicación,
cualquier vista previa trabaja con **datos reales de pacientes**.

Se recomienda una de estas dos opciones:

- **Desactivarlos** (lo más simple): Settings → Git → **Ignored Build Step** →
  "Only build production" (o el comando `[ "$VERCEL_ENV" != "production" ]`
  en "Run my Bash script"). No cargar las variables en el entorno Preview.
- **Protegerlos**: Settings → **Deployment Protection** → **Vercel
  Authentication** activado para Preview. Así solo los miembros del equipo de
  Vercel pueden abrirlos.

Nota: la barra de herramientas de Vercel que aparece en las vistas previas
carga scripts de `vercel.live`, que la política CSP bloquea a propósito. Es
inofensivo; se puede desactivar en Settings → General → Vercel Toolbar.

## 5. Ajustes en Supabase

En Supabase → **Authentication → URL Configuration**:

1. **Site URL**: el dominio de producción, por ejemplo
   `https://<proyecto>.vercel.app` (o el dominio propio, si se usa).
2. **Redirect URLs**: agregar `https://<dominio-de-produccion>/**`.
3. Quitar de esa lista las URLs de `localhost` y de vistas previas que ya no
   se usen en el proyecto de producción.

Si más adelante cambia el dominio, repetir este paso.

## 6. Comprobar el despliegue

### Rutas

Abrir y **recargar** (F5) estas rutas; todas deben cargar la aplicación, no un
error 404:

- `/`
- `/dashboard`
- `/doctor/dashboard`

### Cabeceras

```bash
curl -I https://<dominio>/
curl -I https://<dominio>/doctor/dashboard
curl -I https://<dominio>/assets/<archivo>.js   # tomar el nombre real de la pestaña Network
```

Debe verse:

- En todas: `Strict-Transport-Security`, `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`.
- En `/` y `/doctor/dashboard`: `Cache-Control: no-cache`.
- En `/assets/...`: `Cache-Control: public, max-age=31536000, immutable`.

También se puede pasar el dominio por <https://securityheaders.com>.

### Política de contenido (CSP)

Con la consola del navegador abierta (F12 → Console), recorrer los flujos
principales y confirmar que **no** aparece ningún mensaje
`Refused to ... because it violates the following Content Security Policy`:

- Inicio de sesión de paciente y de la doctora.
- Agendar y reprogramar una cita.
- Receta: **Ver PDF**, **Compartir** (WhatsApp) y vista previa de la firma.
- Paciente: **Estudios** (vista previa de imagen y de PDF) y **Mis datos →
  Imprimir o guardar PDF**.

Probarlo en Safari (iPad) y en Chrome de escritorio. Si aparece un bloqueo,
anotar el mensaje completo: indica qué directiva hay que ajustar en
`vercel.json`.

La CSP está limitada al host exacto del proyecto de Supabase
(`kgropfyhbdetxdzauviq.supabase.co`) en `connect-src`, `img-src` y `frame-src`,
para que un script inyectado no pueda mandar datos a otro proyecto de Supabase.
Si algún día la app apunta a otro proyecto o a un dominio propio, hay que
cambiar ese host en `vercel.json` antes de publicar; si no, la app no podrá
conectarse.

## 7. Volver a una versión anterior (rollback)

1. Vercel → **Deployments**.
2. Buscar el último despliegue de producción que funcionaba.
3. Menú **⋯** → **Instant Rollback** (o **Promote to Production**).

Con la CLI: `vercel rollback <url-del-despliegue>`.

Tener en cuenta:

- Después de un rollback, Vercel deja de asignar automáticamente los nuevos
  despliegues de `master` al dominio de producción hasta que se promueva uno
  nuevo (botón **Undo Rollback** o **Promote**).
- El rollback solo revierte el frontend. Los cambios en la base de datos
  (migraciones de Supabase) **no** se revierten.

## 8. Dominio propio (opcional)

1. Settings → **Domains** → agregar el dominio.
2. Crear en el proveedor de DNS los registros que indique Vercel. El
   certificado HTTPS se emite solo.
3. Actualizar la **Site URL** y las **Redirect URLs** de Supabase (paso 5).

Sobre HSTS: la cabecera incluye `includeSubDomains; preload`. Mientras no se
inscriba el dominio en <https://hstspreload.org>, `preload` no tiene efecto.
Inscribirlo es opcional y **difícil de deshacer**: obliga a que todos los
subdominios funcionen por HTTPS durante meses. Hacerlo solo si se está seguro.

## Resultado de OWASP ZAP (2026-10-12)

Escaneo automático (spider tradicional + ajax) contra
`https://patient-management-amber.vercel.app`, sin atacar el dominio de Supabase.
**0 altos, 2 medios, 0 bajos, 3 informativos.**

| Alerta | Riesgo | Decisión |
|---|---|---|
| CSP: `style-src 'unsafe-inline'` | Medio | **Aceptado.** react-hot-toast inserta una etiqueta `<style>` en tiempo de ejecución y la ventana de impresión de "Mis datos" usa estilos en línea; un hosting estático no puede dar un *nonce*. Los scripts siguen sin `unsafe-inline` ni `unsafe-eval`, que es lo que protege contra XSS. |
| Cross-Domain Misconfiguration (`Access-Control-Allow-Origin: *`) | Medio | **Corregido.** Era el valor por defecto de Vercel en archivos estáticos (sin datos). Ahora `vercel.json` lo fija al dominio de la app. Si se agrega un dominio propio, cambiar ese valor. |
| Re-examine Cache-control | Info | Intencional: `index.html` con `no-cache` (siempre la versión nueva) y `/assets/*` inmutable. |
| Retrieved from Cache / Modern Web Application | Info | Informativos, sin acción. |

Alcance: la app es una SPA con login, así que ZAP solo ve la página pública
(6 rutas). La seguridad de los datos (API de Supabase, RLS, funciones) se cubrió
con las dos auditorías de código y los scripts de verificación de las migraciones.
