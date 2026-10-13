# Recorrido de pruebas pre-producción

Plan de pruebas manual para la dueña del proyecto. Hazlo con **datos de prueba**,
después de aplicar las migraciones 26 y 27 y de desplegar el frontend.

> **Orden obligatorio:** este recorrido va **ANTES** del reinicio
> pre-producción (`supabase/maintenance/reset_test_data.sql`). Después del
> reinicio solo se permiten revisiones de **solo lectura**: entrar como
> doctora y ver los tableros vacíos. No agendes citas ni registres consultas
> de prueba después del reinicio: todo lo que se capture ya es dato real.
> El orden completo está en "Pre-production checklist" de
> `docs/security-runbook.md`.

**Cómo usarlo**

- Marca cada casilla solo si el resultado coincide con lo esperado.
- Si algo falla, anota el número del paso, el dispositivo y una captura.
- Haz el recorrido completo en **escritorio**. Repite en **iPad** (834 px
  vertical y 1194 px horizontal) y en **iPhone** (440 px) los pasos marcados
  con 📱: ahí basta con revisar que todo se lea, quepa sin desplazamiento
  horizontal y que los botones se puedan tocar.
- Usa un teléfono de prueba registrado en Supabase Auth para el portal del
  paciente.

---

## 1. Acceso de la doctora

- [ ] **1.1** 📱 Entra a `/doctor` con el correo y la contraseña de la doctora.
  **Esperado:** abre el Centro Clínico; el encabezado muestra sus secciones.
- [ ] **1.2** Cierra sesión y entra con una contraseña incorrecta.
  **Esperado:** mensaje de error en español; no entra.
- [ ] **1.3** Con la sesión de un paciente, visita `/doctor/dashboard`.
  **Esperado:** no muestra datos clínicos; redirige o niega el acceso.

## 2. Modo solo doctora

- [ ] **2.1** 📱 Activa "Modo solo doctora" en Ajustes.
  **Esperado:** aviso "Modo solo doctora activado."; el portal y la reserva en
  línea muestran que la clínica no recibe citas en línea.
- [ ] **2.2** Con el modo activado, entra al portal con el teléfono de prueba.
  **Esperado:** el portal no muestra citas, recetas, archivos ni datos del
  paciente (migración 27).
- [ ] **2.3** Desactiva el modo.
  **Esperado:** aviso "Modo solo doctora desactivado."; el portal vuelve a
  funcionar.

## 3. Nuevo paciente con consentimiento en papel

- [ ] **3.1** 📱 En Pacientes, "Nuevo Paciente": nombre, apellidos y teléfono.
  **Esperado:** se guarda y aparece en el directorio.
- [ ] **3.2** Registra el aviso de privacidad firmado en papel.
  **Esperado:** el expediente muestra el consentimiento "en persona"; un
  segundo registro no se duplica.
- [ ] **3.3** Intenta crear otro paciente con el mismo teléfono.
  **Esperado:** se rechaza con un mensaje claro.

## 4. Agenda y calendario

- [ ] **4.1** 📱 Agenda una cita para el paciente desde el calendario.
  **Esperado:** aparece en el día y la hora correctos (hora de Monterrey).
- [ ] **4.2** Reprograma la cita a otro horario libre.
  **Esperado:** se mueve; no se encima con otra cita ni con un bloqueo.
- [ ] **4.3** Intenta agendar encima de otra cita.
  **Esperado:** se rechaza.
- [ ] **4.4** "Bloquear Horario" de una hora y "Bloquear Fechas" de un día.
  **Esperado:** el bloqueo se ve en el calendario y esas horas no se ofrecen
  en la reserva en línea.
- [ ] **4.5** Cancela una cita con motivo.
  **Esperado:** queda cancelada y libera el horario.

## 5. Consulta

- [ ] **5.1** 📱 Abre la consulta de la cita.
  **Esperado:** encabezado con nombre, fecha y hora.
- [ ] **5.2** Llena los antecedentes (alergias, enfermedades crónicas) y guarda.
  **Esperado:** se conservan al volver a abrir el expediente.
- [ ] **5.3** Captura signos vitales: presión, oxigenación, peso y talla.
  **Esperado:** se aceptan números; un valor no numérico se rechaza.
- [ ] **5.4** Escribe la nota SOAP y el pronóstico; "Guardar borrador y volver".
  **Esperado:** al regresar, el borrador se recarga completo.
- [ ] **5.5** Agrega a la receta un medicamento con presentación, dosis, vía,
  frecuencia y duración.
  **Esperado:** se guardan todos los campos.
- [ ] **5.6** Con la consulta en borrador, entra al portal del paciente.
  **Esperado:** el paciente **no** ve la receta en borrador (migración 27).

## 6. Finalizar con cobro e insumos

- [ ] **6.1** 📱 "Finalizar Consulta": cobro en efectivo con monto, y los
  insumos sugeridos del servicio.
  **Esperado:** aparece "Consulta finalizada"; la receta ya no se puede
  editar. La nota queda abierta ("Nota pendiente de cerrar" en el calendario,
  en el expediente y en el contador del Centro de Comando).
- [ ] **6.1b** Abre el expediente desde "N notas pendientes de cerrar",
  completa diagnóstico y plan, "Guardar" y luego "Cerrar nota".
  **Esperado:** pide confirmación; después la nota queda de solo lectura y
  desaparece de pendientes. Si se cierra más de 24 h después de la cita,
  dice "Registrada posteriormente · cerrada el …".
- [ ] **6.2** Revisa el inventario de esos insumos.
  **Esperado:** el stock bajó en las cantidades usadas.
- [ ] **6.3** Finaliza otra consulta como cortesía.
  **Esperado:** se guarda sin monto ni método; en Finanzas cuenta como
  cortesía, no como gasto.
- [ ] **6.4** Agrega una nota adicional (adenda) a una nota cerrada.
  **Esperado:** queda debajo de la nota original con fecha; la original no
  cambia.

## 7. Receta oficial: PDF y WhatsApp

- [ ] **7.1** En "Consulta finalizada", genera la receta en PDF.
  **Esperado:** el PDF muestra nombre, cédula, domicilio, fecha, folio y la
  firma dibujada de la doctora.
- [ ] **7.2** 📱 Compártela por WhatsApp (iPhone y iPad).
  **Esperado:** abre la hoja de compartir o WhatsApp; aviso "Receta
  compartida."
- [ ] **7.3** Vuelve a generar la misma receta.
  **Esperado:** mismo folio y mismos datos (la emisión no cambia).
- [ ] **7.4** Con la receta finalizada, revisa el portal del paciente.
  **Esperado:** el paciente ve sus medicamentos e indicaciones.

## 8. Control de peso

- [ ] **8.1** 📱 Activa "Control de peso" para el paciente y captura una
  medición InBody.
  **Esperado:** aparece en la tabla y en la gráfica.
- [ ] **8.2** Captura una segunda medición en otra fecha.
  **Esperado:** la gráfica muestra la tendencia; una fecha futura se rechaza.

## 9. Catálogo e inventario

- [ ] **9.1** 📱 En Catálogo, edita un servicio y en sus insumos usa "Nuevo
  insumo".
  **Esperado:** el insumo se crea y queda ligado al servicio sin salir del
  formulario; la lista larga de insumos se ve compacta.
- [ ] **9.2** En Inventario, "Registrar compra" con cantidad y costo total.
  **Esperado:** sube el stock; la compra aparece en Gastos de Finanzas.
- [ ] **9.3** Registra un uso manual.
  **Esperado:** baja el stock; un uso mayor al stock se rechaza.
- [ ] **9.4** Abre el historial de movimientos del insumo.
  **Esperado:** aparecen compra, uso e inventario inicial en orden, también
  los usos de consulta.

## 10. Finanzas

- [ ] **10.1** 📱 Como doctora, abre "Finanzas y Métricas".
  **Esperado:** ingresos, gastos, ganancia y cortesías del mes; cada cobro
  muestra servicio y paciente.
- [ ] **10.2** Revisa "Ganancia por procedimiento".
  **Esperado:** cobrado menos costo de insumos por servicio; las cortesías no
  restan.
- [ ] **10.3** Cambia a "Este año" y a la vista Tabla.
  **Esperado:** los meses cuadran con los movimientos.
- [ ] **10.4** Entra con una cuenta **admin** (si existe).
  **Esperado:** solo ve Administración; en Finanzas ve montos y servicios,
  **nunca** nombres de pacientes; el historial de inventario no muestra a qué
  consulta se ligó un insumo.

## 11. Solicitudes ARCO

- [ ] **11.1** Registra una solicitud recibida en persona (acceso o
  rectificación).
  **Esperado:** aparece en "Solicitudes pendientes de respuesta" con su canal.
- [ ] **11.2** Resuélvela con una respuesta.
  **Esperado:** cambia de estado y guarda la respuesta.

## 12. Bitácora

- [ ] **12.1** Abre la Bitácora.
  **Esperado:** aparecen los cambios de los pasos anteriores (paciente, nota,
  receta, cobro, envío de receta) con fecha y rol, sin contenido clínico.
- [ ] **12.2** Intenta borrar un registro.
  **Esperado:** no existe la opción; la bitácora no se puede editar.

## 13. Portal del paciente (modo solo doctora DESACTIVADO)

- [ ] **13.1** 📱 Desde la página pública, "Agendar Cita" con un teléfono de
  prueba nuevo: elige servicio, día y hora; recibe y escribe el código OTP;
  acepta el aviso de privacidad.
  **Esperado:** la cita queda "pendiente" y la doctora la ve.
- [ ] **13.2** En el calendario de reserva, intenta ir a más de 120 días.
  **Esperado:** el calendario no lo permite; solo ofrece horarios dentro del
  horario de la clínica, cada 15 minutos.
- [ ] **13.3** "Entrar a mi Portal" con el mismo teléfono.
  **Esperado:** ve su nombre, sus citas y su receta finalizada; **no** ve los
  recordatorios internos de la doctora.
- [ ] **13.4** Reprograma la cita tres veces.
  **Esperado:** las tres funcionan; la cuarta muestra que debe llamar a la
  clínica.
- [ ] **13.5** Intenta cancelar o reprogramar una cita que ya pasó o que ya
  tiene consulta.
  **Esperado:** se rechaza con un mensaje claro.
- [ ] **13.6** Descarga o imprime "mis datos".
  **Esperado:** contiene sus datos, citas y recetas; no contiene notas SOAP ni
  recordatorios internos.
- [ ] **13.7** Envía una solicitud ARCO desde el portal.
  **Esperado:** confirmación en pantalla; la doctora la ve en Solicitudes.
- [ ] **13.8** Cierra sesión.
  **Esperado:** vuelve a la página pública; el portal pide código otra vez.

## 14. Revisión visual por dispositivo

- [ ] **14.1** Escritorio: todas las secciones de la doctora sin cortes.
- [ ] **14.2** iPad 834 px (vertical): calendario, consulta, Finanzas e
  Inventario legibles, sin desplazamiento horizontal.
- [ ] **14.3** iPad 1194 px (horizontal): igual que 14.2.
- [ ] **14.4** iPhone 440 px: portal del paciente, reserva y consulta
  utilizables con una mano; textos de al menos 16 px en los campos.

---

**Al terminar:** si todo está marcado, sigue con la lista "Pre-production
checklist" de `docs/security-runbook.md` (reinicio pre-producción incluido).
