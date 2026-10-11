# Pruebas de carga (k6)

Dos guiones:

| Guion | Qué mide | Escribe datos |
| --- | --- | --- |
| `booking-concurrency.js` | 20 usuarios piden **el mismo horario** a la vez con `staff_create_appointment`: debe ganar 1 y rechazarse 19 | Sí, 1 cita |
| `smoke.js` | 10 usuarios anónimos durante 30 s leen `get_availability` y `get_clinic_schedule`, como la pantalla pública de reserva | No |

> **Nunca contra producción después del arranque.** La prueba de
> concurrencia crea una cita real y ambas cargan el servidor. Córrelas solo en
> pre-producción, antes del reinicio
> (`supabase/maintenance/reset_test_data.sql`).

## Instalar k6

```powershell
winget install k6 --source winget
```

Cierra y vuelve a abrir PowerShell y comprueba con `k6 version`.

## Antes de correr la prueba de concurrencia

1. **Apaga los avisos de WhatsApp** (la cita creada y su cancelación disparan
   el trigger). En el SQL Editor de Supabase:

   ```sql
   alter table public.appointments disable trigger whatsapp_notifications;
   ```

2. Elige los datos:
   - **Paciente**: uno de prueba y no archivado; por ejemplo uno `E2E-…`
     creado por las pruebas de Playwright. Su `id` está en Table Editor →
     `patients`.
   - **Servicio**: uno activo; su `id` está en Table Editor → `services`.
   - **Horario**: uno **libre y futuro**, dentro del horario de la clínica.
     Revísalo en el Calendario. Escríbelo en UTC: Monterrey es UTC−6 todo el
     año, así que las 10:00 a. m. del 20 de octubre de 2026 son
     `2026-10-20T16:00:00Z`.

## Variables de entorno (PowerShell)

La URL y la llave anon son las de tu `.env` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`). La contraseña solo vive en la ventana abierta; el
guion nunca imprime el token de sesión.

```powershell
$env:K6_SUPABASE_URL = "https://<proyecto>.supabase.co"
$env:K6_SUPABASE_ANON_KEY = "<llave anon>"
$env:K6_DOCTOR_EMAIL = "correo-de-la-doctora@ejemplo.com"
$env:K6_DOCTOR_PASSWORD = Read-Host "Contraseña de la doctora" -MaskInput
$env:K6_PATIENT_ID = "<uuid del paciente>"
$env:K6_SERVICE_ID = "<uuid del servicio>"
$env:K6_SLOT_ISO = "2026-10-20T16:00:00Z"
# Opcional: cancelar al final la cita creada
$env:K6_CLEANUP = "1"
```

`smoke.js` solo necesita `K6_SUPABASE_URL` y `K6_SUPABASE_ANON_KEY`.

## Cómo correrlas

```powershell
k6 run load/booking-concurrency.js
k6 run load/smoke.js
```

La prueba de concurrencia usa un horario: si quieres repetirla, cancela la cita
creada o elige otro `K6_SLOT_ISO`.

## Cómo leer el resultado

Al final cada guion imprime un resumen y una línea `PASS`/`FAIL` por
umbral. Si algún umbral falla, k6 termina con código distinto de 0.

**`booking-concurrency.js`**

| Línea | Esperado | Si no |
| --- | --- | --- |
| `booked (2xx)` | 1 | 0: el horario no estaba libre, ya pasó o el servicio/paciente no sirve (mira los avisos "Unexpected answer"). **2 o más: doble reserva, es un error grave; detente y repórtalo.** |
| `refused, overlap P0001` | 19 | Deben rechazarse con "El horario seleccionado acaba de ocuparse. Por favor elige otro." |
| `server errors (5xx)` | 0 | Error del servidor o de la base de datos. |
| `other answers` | 0 | Respuestas inesperadas (permisos, paciente archivado, horario bloqueado). |
| `latency p95` | < 1500 ms | El candado de reservas atiende las 20 peticiones una por una, así que la espera es parte de la medición; si se pasa, revisa la región y el plan de Supabase. |

**`smoke.js`**

| Línea | Esperado |
| --- | --- |
| `failed requests` | < 1 % |
| `latency p95` | < 800 ms |
| `checks` | > 99 % (cada respuesta es 200 y trae datos con la forma correcta) |

## Limpieza

- La prueba de concurrencia deja **una cita** en el horario elegido. Al
  terminar imprime su `id`. Puedes:
  - correrla con `K6_CLEANUP=1`, que la cancela al final;
  - cancelarla en el Calendario ("Cancelar Cita"), o
  - dejarla: el reinicio pre-producción la borra.
- Vuelve a encender los avisos de WhatsApp:

  ```sql
  alter table public.appointments enable trigger whatsapp_notifications;
  ```

- `smoke.js` no deja nada.
