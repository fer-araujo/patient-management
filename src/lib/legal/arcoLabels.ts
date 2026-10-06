import type {
  ArcoChannel,
  ArcoRequestStatus,
  ArcoRequestType,
} from "../services/privacyService";

/** How a request recorded by the doctor reached the clinic. */
export const ARCO_CHANNEL_LABELS: Record<ArcoChannel, string> = {
  presencial: "En persona",
  telefono: "Por teléfono",
  correo: "Por correo",
  escrito: "Por escrito",
};

/** Plain-Spanish labels shared by the patient portal and the admin panel. */
export const ARCO_TYPE_LABELS: Record<
  ArcoRequestType,
  { title: string; description: string }
> = {
  access: {
    title: "Resumen clínico",
    description: "Quiero que la doctora me entregue un resumen de mis consultas.",
  },
  rectification: {
    title: "Corregir mis datos",
    description: "Algún dato mío está mal, incompleto o desactualizado.",
  },
  cancellation: {
    title: "Borrar mis datos",
    description:
      "Ya no quiero que la clínica conserve mis datos personales.",
  },
  opposition: {
    title: "Oponerme a un uso",
    description:
      "No quiero que usen mis datos para algo en particular (por ejemplo, avisos o promociones).",
  },
  revocation: {
    title: "Retirar mi consentimiento",
    description: "Ya no autorizo el uso de mis datos que acepté antes.",
  },
};

/**
 * Types offered in the portal form. The download covers the patient's own
 * data; "access" asks the doctor for a clinical summary (NOM-004 5.5).
 */
export const ARCO_FORM_TYPES: ArcoRequestType[] = [
  "access",
  "rectification",
  "cancellation",
  "opposition",
  "revocation",
];

export const ARCO_STATUS_LABELS: Record<
  ArcoRequestStatus,
  { label: string; className: string }
> = {
  received: { label: "Recibida", className: "bg-sky-100 text-sky-900" },
  in_progress: { label: "En trámite", className: "bg-amber-100 text-amber-900" },
  resolved: { label: "Atendida", className: "bg-emerald-100 text-emerald-900" },
  rejected: { label: "Rechazada", className: "bg-rose-100 text-rose-900" },
};
