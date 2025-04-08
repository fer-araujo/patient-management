declare type SearchParamProps = {
  params: { [key: string]: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

declare type Status = "pending" | "scheduled" | "cancelled";

declare interface CreatePatientParams {
  name: string;
  phone: string;
  studyDocument?: FormData | undefined;
}

declare interface Patient extends CreatePatientParams {
  $id: string;
}

declare type CreateAppointmentParams = {
  patientId: string;
  reason?: string;
  schedule: string;
  status: Status;
};

declare type UpdateAppointmentParams = {
  appointmentId: string;
  appointment: Appointment;
  type: string;
};
