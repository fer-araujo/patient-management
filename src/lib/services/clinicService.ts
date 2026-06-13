import { combineVisualDateAndTime } from "../../features/doctor/utils/calendarUtils";
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
}

// INTERFAZ ESTRICTA PARA SUPABASE (CERO 'any')
interface RawAppointmentData {
  id: string;
  start_time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  patient_id: string;
  patients: { first_name: string; last_name: string; phone: string } | null;
  services: { name: string; duration_mins: number } | null;
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
      patients (
        first_name,
        last_name,
        phone
      ),
      services (
        name,
        duration_mins
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
    const startDate = new Date(apt.start_time);

    const formattedDate = startDate
      .toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/\./g, "");

    const h = startDate.getHours();
    const m = String(startDate.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12; // Convierte formato 24h a 12h
    const cleanTime = `${String(h12).padStart(2, "0")}:${m} ${ampm}`;

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
    };
  });
};

// 2. ACTUALIZAR ESTADO (Aprobar, Rechazar, Cancelar, Completar)
export const updateAppointmentStatus = async (
  id: string,
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected",
) => {
  const { error } = await supabase
    .from("appointments")
    .update({ status, updated_by: "doctor" })
    .eq("id", id);

  if (error) {
    console.error("Error al actualizar estado:", error.message);
    throw new Error("No se pudo actualizar la cita.");
  }
};

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

  const { error } = await supabase.from("appointments").insert({
    patient_id: patientId,
    service_id: srv.id,
    start_time: utcIsoDateTime,
    status: "confirmed",
    updated_by: "doctor",
  });

  if (error) {
    console.error("Error al crear cita:", error.message);
    throw new Error("No se pudo agendar la cita.");
  }
};

// 4. REPROGRAMAR CITA
export const rescheduleAppointment = async (
  id: string,
  isoDateTime: string,
  updaterRole: "patient" | "doctor" = "patient",
) => {
  const { error } = await supabase
    .from("appointments")
    .update({
      start_time: isoDateTime,
      status: "pending",
      updated_by: updaterRole,
    }) // AHORA SE QUEDA PENDIENTE
    .eq("id", id);

  if (error) {
    console.error("Error al reprogramar:", error.message);
    throw new Error("No se pudo reprogramar la cita.");
  }
};

export const cancelAppointment = async (
  id: string,
  reason: string,
  updaterRole: "patient" | "doctor" = "patient",
) => {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancel_reason: reason,
      updated_by: updaterRole,
    })
    .eq("id", id);
  if (error) throw new Error("No se pudo cancelar la cita.");
};
