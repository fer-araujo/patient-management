import type { MyDataExport } from "../../../lib/services/privacyService";
import { ARCO_STATUS_LABELS, ARCO_TYPE_LABELS } from "../../../lib/legal/arcoLabels";

// Renders the patient's data export as a readable, printable document so a
// patient can read it or save it as PDF from the browser's print dialog.
// Every value comes from the database and may contain patient-typed text, so
// all of it is HTML-escaped before it is written into the document.

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (iso: string | null | undefined, withTime = false): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
};

const APPOINTMENT_STATUS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  rejected: "Rechazada",
};

// Stored as "{patientId}/{timestamp}_{original name}"; show the original name.
const cleanFileName = (path: string): string =>
  (path.split("/").pop() ?? path).replace(/^\d+_/, "");

const row = (label: string, value: unknown): string =>
  value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : "";

const section = (title: string, body: string): string =>
  `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;

const empty = (text: string): string => `<p class="muted">${escapeHtml(text)}</p>`;

const buildDocument = (data: MyDataExport): string => {
  const p = data.profile;
  const fullName = [p?.first_name, p?.last_name].filter(Boolean).join(" ");

  const profile = section(
    "Datos personales",
    `<table>${[
      row("Nombre", fullName),
      row("Teléfono", p?.phone),
      row("Correo", p?.email),
      row("Fecha de nacimiento", p?.dob ? formatDate(p.dob) : null),
      row("Sexo", p?.gender),
      row("Tipo de sangre", p?.blood_type),
      row("Alergias", p?.allergies),
      row("Padecimientos crónicos", p?.chronic_conditions),
      row("Referido por", p?.referred_by),
      row("Paciente desde", p?.created_at ? formatDate(p.created_at) : null),
    ].join("")}</table>`,
  );

  const appointments = section(
    "Citas",
    data.appointments.length === 0
      ? empty("No hay citas registradas.")
      : data.appointments
          .map(
            (a) => `<div class="item">
              <p class="item-title">${escapeHtml(a.service ?? "Consulta")} · ${escapeHtml(formatDate(a.start_time, true))}</p>
              <p>Estado: ${escapeHtml(APPOINTMENT_STATUS[a.status] ?? a.status)}</p>
              ${a.reason ? `<p>Motivo: ${escapeHtml(a.reason)}</p>` : ""}
              ${a.cancel_reason ? `<p>Motivo de cancelación: ${escapeHtml(a.cancel_reason)}</p>` : ""}
            </div>`,
          )
          .join(""),
  );

  // Consultation notes are the doctor's record (NOM-004). The patient gets a
  // clinical summary on request instead of the raw notes.
  const clinicalSummary = section(
    "Resumen clínico",
    `<p class="notice">Tus notas de consulta forman parte del expediente de la doctora. Puedes pedir tu resumen clínico desde tu portal: Mis datos personales → Pedir un cambio → Resumen clínico.</p>`,
  );

  const medications = section(
    "Medicamentos indicados",
    `<p class="notice">Registro informativo del expediente. No es una receta médica oficial.</p>${
      data.prescriptions.length === 0
        ? empty("No hay medicamentos registrados.")
        : data.prescriptions
            .map(
              (pr) => `<div class="item">
                <p class="item-title">${escapeHtml(formatDate(pr.created_at))}</p>
                <ul>${pr.medications
                  .map(
                    (m) =>
                      `<li><strong>${escapeHtml(m.nombre)}</strong>${m.dosis ? ` — ${escapeHtml(m.dosis)}` : ""}${m.indicaciones ? `<br>${escapeHtml(m.indicaciones)}` : ""}</li>`,
                  )
                  .join("")}</ul>
              </div>`,
            )
            .join("")
    }`,
  );

  const files = section(
    "Estudios y archivos",
    data.files.length === 0
      ? empty("No hay archivos.")
      : `<ul>${data.files
          .map(
            (f) =>
              `<li>${escapeHtml(cleanFileName(f.name))} · ${escapeHtml(formatDate(f.uploaded_at))}</li>`,
          )
          .join("")}</ul><p class="muted">Puedes ver y abrir tus estudios desde tu portal, en "Estudios".</p>`,
  );

  const consents = section(
    "Consentimientos",
    data.consents.length === 0
      ? empty("No hay consentimientos registrados.")
      : `<ul>${data.consents
          .map(
            (c) =>
              `<li>Aviso de Privacidad (versión ${escapeHtml(c.version)}) aceptado el ${escapeHtml(formatDate(c.accepted_at, true))}</li>`,
          )
          .join("")}</ul>`,
  );

  const requests =
    data.arco_requests.length === 0
      ? ""
      : section(
          "Solicitudes sobre mis datos",
          `<ul>${data.arco_requests
            .map(
              (r) =>
                `<li>${escapeHtml(ARCO_TYPE_LABELS[r.request_type]?.title ?? r.request_type)} · ${escapeHtml(formatDate(r.created_at))} · ${escapeHtml(ARCO_STATUS_LABELS[r.status]?.label ?? r.status)}${r.resolution_note ? `<br>Respuesta: ${escapeHtml(r.resolution_note)}` : ""}</li>`,
            )
            .join("")}</ul>`,
        );

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Mis datos · Dra. Carmen Torres</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #040707; max-width: 760px; margin: 32px auto; padding: 0 24px; line-height: 1.5; font-size: 14px; }
  header { border-bottom: 2px solid #07a996; padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  h1 { font-size: 22px; margin: 0; }
  header p { margin: 4px 0 0; color: #5b5b5b; font-size: 13px; }
  h2 { font-size: 16px; color: #07a996; margin: 28px 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; color: #5b5b5b; width: 34%; padding: 4px 8px 4px 0; vertical-align: top; }
  td { padding: 4px 0; vertical-align: top; white-space: pre-wrap; }
  .item { border: 1px solid #e7f2f1; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .item p { margin: 2px 0; }
  .item-title { font-weight: 700; }
  .addendum { background: #e7f2f1; border-radius: 8px; padding: 6px 10px; margin-top: 8px !important; white-space: pre-wrap; }
  .notice { background: #e7f2f1; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
  .muted { color: #5b5b5b; }
  ul { padding-left: 18px; margin: 4px 0; }
  li { margin-bottom: 6px; }
  button { background: #07a996; color: #fff; border: 0; border-radius: 12px; padding: 10px 18px; font-weight: 600; font-size: 14px; cursor: pointer; }
  @media print { button { display: none; } body { margin: 0; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>Mis datos personales</h1>
    <p>Dra. Carmen Torres · Generado el ${escapeHtml(formatDate(data.generated_at, true))}</p>
  </div>
  <button onclick="window.print()">Imprimir o guardar PDF</button>
</header>
${profile}${appointments}${clinicalSummary}${medications}${files}${consents}${requests}
</body>
</html>`;
};

/**
 * Opens a blank window synchronously (so the browser does not treat it as an
 * unsolicited popup), then fills it once the data arrives.
 */
export const openMyDataWindow = (): Window | null => {
  const win = window.open("", "_blank");
  if (win) {
    win.document.write(
      '<p style="font-family:system-ui;padding:32px;color:#5b5b5b">Preparando tus datos…</p>',
    );
  }
  return win;
};

export const renderMyDataDocument = (win: Window, data: MyDataExport): void => {
  win.document.open();
  win.document.write(buildDocument(data));
  win.document.close();
};
