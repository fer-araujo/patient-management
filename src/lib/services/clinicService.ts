import { combineVisualDateAndTime } from "../../features/doctor/utils/calendarUtils";
import { formatClinicShortDate, formatClinicTime12h } from "../clinicTime";
import { supabase } from "../supabase";

export interface DashboardAppointment {
  id: string;
  patientId: string;
  patientName: string;
  service: string;
  date: string;
  time: string;
  phone: string;
  isNewPatient: boolean;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  durationMins: number;
  /** "Motivo de la consulta" typed by the patient when booking. */
  reason: string | null;
  /** Catalog price of the service, used to pre-fill the charge. */
  servicePrice?: number | null;
  /** patients.status; an "archived" patient cannot be booked by the staff. */
  patientStatus?: "active" | "blocked" | "archived" | null;
}

// INTERFAZ ESTRICTA PARA SUPABASE (CERO 'any')
interface RawAppointmentData {
  id: string;
  start_time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  patient_id: string;
  reason: string | null;
  patients: {
    first_name: string;
    last_name: string;
    phone: string;
    status: "active" | "blocked" | "archived" | null;
  } | null;
  services: {
    name: string;
    duration_mins: number;
    price: number | string | null;
  } | null;
}

export const fetchDoctorAppointments = async (): Promise<
  DashboardAppointment[]
> => {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      start_time,
      status,
      patient_id,
      reason,
      patients (
        first_name,
        last_name,
        phone,
        status
      ),
      services (
        name,
        duration_mins,
        price
      )
    `,
    )
    .order("start_time", { ascending: true })
    .returns<RawAppointmentData[]>();

  if (error) {
    console.error("Error al obtener las citas:", error.message);
    throw new Error("No se pudieron cargar las citas");
  }

  if (!data) return [];

  return data.map((apt) => {
    // Clinic wall clock, so the calendar grid, past-slot checks and
    // availability (all in clinic time) agree whatever the browser zone.
    const startDate = new Date(apt.start_time);
    const formattedDate = formatClinicShortDate(startDate);
    const cleanTime = formatClinicTime12h(startDate);

    const firstName = apt.patients?.first_name || "Paciente";
    const lastName = apt.patients?.last_name || "Desconocido";
    const phone = apt.patients?.phone || "Sin teléfono";
    const serviceName = apt.services?.name || "Servicio eliminado";
    const duration = apt.services?.duration_mins || 60;

    return {
      id: apt.id,
      patientId: apt.patient_id,
      patientName: `${firstName} ${lastName}`,
      service: serviceName,
      date: formattedDate,
      time: cleanTime,
      phone: phone,
      isNewPatient: true,
      status: apt.status,
      durationMins: duration,
      reason: apt.reason?.trim() || null,
      servicePrice:
        apt.services?.price === null || apt.services?.price === undefined
          ? null
          : Number(apt.services.price),
      patientStatus: apt.patients?.status ?? null,
    };
  });
};

// 2. ACTUALIZAR ESTADO (Aprobar, Rechazar, Cancelar, Completar)
export const updateAppointmentStatus = async (
  id: string,
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected",
) => {
  // updated_by is never sent from the client: the appointments_set_updated_by
  // trigger derives it from the caller's role, so a patient session cannot make
  // a change look like it came from the doctor.
  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("Error al actualizar estado:", error.message);
    throw new Error("No se pudo actualizar la cita.");
  }
};

/** Slot conflicts raised on purpose by the booking RPCs carry code P0001 and a Spanish message. */
const rpcError = (error: { code?: string; message: string }, fallback: string) =>
  new Error(error.code === "P0001" ? error.message : fallback);

// 3. CREAR NUEVA CITA (Agendar)
export const createAppointment = async (
  patientId: string,
  serviceName: string,
  dateStr: string,
  timeStr: string,
) => {
  const { data: srv, error: srvError } = await supabase
    .from("services")
    .select("id")
    .eq("name", serviceName)
    .single();
  if (srvError || !srv)
    throw new Error("El servicio seleccionado no existe en el catálogo.");

  // Usamos el nuevo traductor que respeta tu zona horaria
  const utcIsoDateTime = combineVisualDateAndTime(dateStr, timeStr);

  // staff_create_appointment runs the same locked overlap check as patient
  // bookings, so two bookings can never take the same slot at once.
  const { error } = await supabase.rpc("staff_create_appointment", {
    p_patient_id: patientId,
    p_service_id: srv.id,
    p_start_time: utcIsoDateTime,
  });

  if (error) {
    console.error("Error al crear cita:", error.message);
    throw rpcError(error, "No se pudo agendar la cita.");
  }
};

// 4. REPROGRAMAR CITA (staff)
// Patients use rescheduleMyAppointment in patientBookingService instead: RLS
// gives them no UPDATE privilege on appointments. The RPC checks the new slot
// (ignoring the appointment itself) and sets the status back to "pending".
export const rescheduleAppointment = async (
  id: string,
  isoDateTime: string,
) => {
  const { error } = await supabase.rpc("staff_reschedule_appointment", {
    p_appointment_id: id,
    p_start_time: isoDateTime,
  });

  if (error) {
    console.error("Error al reprogramar:", error.message);
    throw rpcError(error, "No se pudo reprogramar la cita.");
  }
};

// 5. CANCELAR CITA (staff) - ver cancelMyAppointment para el portal del paciente
export const cancelAppointment = async (id: string, reason: string) => {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancel_reason: reason,
    })
    .eq("id", id);
  if (error) throw new Error("No se pudo cancelar la cita.");
};
