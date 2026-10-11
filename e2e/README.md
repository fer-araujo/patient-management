# Pruebas end-to-end (Playwright)

Automatizan los caminos críticos de la doctora de `docs/qa-walkthrough.md`
en escritorio, iPad (vertical y horizontal) e iPhone. Usan la app real que
tú levantas y **escriben datos de prueba en el proyecto de Supabase** al que
apunta tu `.env`.

> **Solo antes del reinicio pre-producción.** Las consultas finalizadas no se
> pueden borrar (NOM-004); únicamente el reinicio
> (`supabase/maintenance/reset_test_data.sql`) las elimina. Nunca corras esta
> suite contra producción después del arranque.

## Qué revisa

| Prueba | Paso del recorrido | Proyectos |
| --- | --- | --- |
| Entrar como doctora y ver "Centro de Comando" (proyecto `setup`) | 1.1 | todos |
| Ninguna pestaña principal se desplaza hacia los lados | 1.1, 14 | todos |
| Directorio: paciente nuevo con aviso en papel → "Aviso firmado" | 3.1, 3.2 | todos |
| Calendario: agendar, reprogramar y cancelar una cita | 4.1, 4.2, 4.5 | todos |
| Consulta: antecedentes, signos vitales, SOAP, pronóstico, medicamento, finalizar como cortesía sin insumos → "Consulta finalizada" | 5.1-5.5, 6.3 | todos |
| Control de peso: activarlo y capturar una medición | 8.1 | todos |
| Catálogo: "Nuevo insumo" dentro del formulario de un servicio | 9.1 | todos |
| Finanzas: tarjetas y "Ganancia por procedimiento" | 10.1, 10.2 | todos |
| Cuenta admin: solo Administración; Finanzas sin nombres de pacientes | 10.4 | `admin` |
| Táctil: Dropdown y Modal con toques; tarjetas en el iPhone | 14.2-14.4 | `ipad`, `ipad-landscape`, `iphone` |

**No cubre** (sigue siendo manual): el portal del paciente y el código OTP,
el modo solo doctora, el PDF y el envío por WhatsApp de la receta, cobros con
monto e insumos (baja de inventario), compras y usos de inventario, bloqueos
de horario, adendas, solicitudes ARCO, el contenido de la Bitácora y la
validación de valores incorrectos.

## Antes de correrla

1. **Apaga los avisos de WhatsApp.** Las pruebas crean, reprograman y cancelan
   citas, y cada cambio dispara el trigger `whatsapp_notifications`
   (`supabase/migrations/20260922180600_whatsapp_webhook_secret.sql`). En el
   SQL Editor de Supabase:

   ```sql
   alter table public.appointments disable trigger whatsapp_notifications;
   ```

   Para confirmarlo (`D` = apagado, `O` = encendido):

   ```sql
   select tgname, tgenabled
   from pg_trigger
   where tgrelid = 'public.appointments'::regclass
     and tgname = 'whatsapp_notifications';
   ```

   Además, los pacientes de prueba usan teléfonos que empiezan con `00`, que
   no existen; aun así, apaga el trigger.

2. **Modo solo doctora.** Las pruebas no lo cambian y funcionan con él
   encendido o apagado. Recomendado: **encendido**, para que nadie reserve en
   línea mientras corren.

3. **El catálogo** debe tener al menos un servicio activo de 2 horas o menos
   (se usa el más corto para las citas de prueba).

4. **Levanta la app** en otra terminal y déjala corriendo:

   ```powershell
   npm run dev
   ```

## Variables de entorno (PowerShell)

Las credenciales solo se leen de variables de entorno: nunca las escribas en
un archivo del proyecto. Viven mientras la ventana de PowerShell esté
abierta.

```powershell
$env:E2E_DOCTOR_EMAIL = "correo-de-la-doctora@ejemplo.com"
$env:E2E_DOCTOR_PASSWORD = Read-Host "Contraseña de la doctora" -MaskInput

# Opcional: la prueba de la cuenta admin
$env:E2E_ADMIN_EMAIL = "correo-admin@ejemplo.com"
$env:E2E_ADMIN_PASSWORD = Read-Host "Contraseña admin" -MaskInput

# Opcional: si la app no está en http://localhost:5173
$env:E2E_BASE_URL = "http://localhost:5173"
```

`-MaskInput` necesita PowerShell 7. En Windows PowerShell 5.1 usa
`$env:E2E_DOCTOR_PASSWORD = Read-Host "Contraseña de la doctora"` (se verá al
escribirla).

La URL y la llave anon de Supabase se toman del mismo `.env` que usa la app
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Para otro proyecto, define
`E2E_SUPABASE_URL` y `E2E_SUPABASE_ANON_KEY`.

Sin `E2E_DOCTOR_EMAIL`/`E2E_DOCTOR_PASSWORD` las pruebas se marcan como
omitidas (skipped) con un mensaje que lo explica; sin las de admin, solo se
omite la prueba admin.

## Cómo correrla

```powershell
npm run e2e                               # todo: escritorio, iPad, iPad horizontal, iPhone y admin
npm run e2e -- --project=ipad             # solo iPad vertical
npm run e2e -- --project=iphone           # solo iPhone
npm run e2e -- --project=desktop --project=admin
npm run e2e:ui                            # modo visual, paso a paso
npx playwright show-report e2e-report     # abre el reporte HTML de la última corrida
```

- El proyecto `setup` entra una sola vez como doctora (y como admin, si hay
  credenciales) y guarda la sesión en `e2e/.auth/` (ignorado por git). Corre
  solo, antes de cualquier otro proyecto.
- Las pruebas van **una tras otra** (un solo worker): comparten el calendario
  de la clínica y buscan horarios libres justo antes de agendar.
- Las pruebas nunca cierran sesión: en Supabase, "Cerrar sesión" revoca la
  sesión que reutilizan los demás proyectos. La sesión dura 1 hora; si una
  corrida completa tardara más, vuelve a correrla.
- Si algo falla, el reporte HTML trae la captura de pantalla del momento.

## Qué datos crea

Por cada proyecto de dispositivo (`desktop`, `ipad`, `ipad-landscape`,
`iphone`):

- Un paciente `E2E-<número> Paciente <proyecto>`, con teléfono `00…`, aviso
  de privacidad registrado "en persona" y control de peso activado.
- Citas en días futuros: una cancelada y una completada, ambas agendadas
  desde el calendario (ver "Corregido" abajo).
- Una consulta finalizada como cortesía, con nota SOAP, signos vitales,
  antecedentes y una receta con un medicamento `Paracetamol E2E …`.
- Una medición de peso (71.3 kg).
- Un artículo de inventario `E2E-insumo-<número>`, archivado al final.

**El reinicio pre-producción borra todo lo anterior excepto los artículos de
inventario**: el reinicio conserva el catálogo y los artículos (solo pone su
stock en 0). Los `E2E-insumo-…` quedan archivados, con stock 0 y sin ligarse a
ningún servicio. Para revisarlos:

```sql
select id, name, is_active, stock_quantity
from public.inventory
where name like 'E2E-insumo-%';
```

## Después de correrla

Vuelve a encender los avisos de WhatsApp:

```sql
alter table public.appointments enable trigger whatsapp_notifications;
```

y confirma con la consulta de arriba que `tgenabled` sea `O`.

## Corregido

En **Calendario → Agendar Cita**, las listas "Buscar Paciente" y "Servicio a
realizar" se armaban con las citas existentes, así que un paciente recién
creado o un servicio nunca agendado no aparecían (y tras el reinicio, sin
citas, no se podía agendar nada). **Corregido**: ahora leen el directorio de
pacientes (sin archivados ni anonimizados; los suspendidos sí se pueden
agendar) y los servicios activos del catálogo al abrir el modal, con la
duración real de cada servicio. La suite ya no crea ni cancela una cita por
API para "anclar" al paciente: agenda directamente desde el calendario.
