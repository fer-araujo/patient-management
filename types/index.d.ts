
declare type SearchParamProps = {
  params: { [key: string]: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

declare type Status = "pending" | "scheduled" | "cancelled" | "rescheduled" | "denied";

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

export type UpdateAppointmentParams = {
  appointmentId: string;
  reason: string;
  schedule: string;
  status: Status;
  cancellationReason?: string | null;
};