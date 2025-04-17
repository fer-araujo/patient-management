"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Appointment } from "@/types/appwrite.types";
import { formatDateTime, formatPhoneNumber } from "@/lib/utils";
import StatusBadge from "../StatusBadge";
import AppointmentModal from "../AppointmentModal";
import StudiesModal from "../StudiesModal";

export type Payment = {
  id: string;
  amount: number;
  status: "pending" | "processing" | "success" | "failed";
  email: string;
};

export const columns: ColumnDef<Appointment>[] = [
  {
    accessorKey: "patient",
    header: "Paciente",
    cell: ({ row }) => {
      const appointment = row.original;
      const patient = appointment.patientId.name;
      return <p className="text-sm font-light">{patient}</p>;
    },
  },
  {
    accessorKey: "phone",
    header: "Telefono",
    cell: ({ row }) => {
      const appointment = row.original;
      const phone = formatPhoneNumber(appointment.patientId.phone);
      return <p className="text-sm font-light">{phone}</p>;
    },
  },
  {
    accessorKey: "reason",
    header: "Motivo",
    cell: ({ row }) => {
      const appointment = row.original;
      const reason = appointment.reason;
      return (
        <p className="text-sm font-light text-wrap line-clamp-3">{reason}</p>
      );
    },
  },
  {
    accessorKey: "studies",
    header: "Estudios",
    cell: ({ row }) => {
      const appointment = row.original;
      const studies = appointment.patientId.studyFiles;
      const studiesList = studies.map((study: { fileId: string }) => {
        return { id:study.fileId };
      });
      const button =
        studiesList.length > 0 ? (
          <StudiesModal
            studies={studiesList}
            patientName={appointment.patientId.name}
          />
        ) : (
          <p className="text-sm font-light">No hay estudios</p>
        );
      return button;
    },
  },
  {
    accessorKey: "status",
    header: "Estatus",
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <div className="min-w-[115px]">
          <StatusBadge status={status} />
        </div>
      );
    },
  },
  {
    accessorKey: "appointmentDate",
    header: "Fecha de Cita",
    cell: ({ row }) => {
      const appointmentDate = row.original.schedule;
      return (
        <p className="text-regular font-light">
          {formatDateTime(appointmentDate).dateTime}
        </p>
      );
    },
  },
  {
    id: "actions",
    header: () => <div className="pl-4">Acciones</div>,
    cell: ({ row: { original: data } }) => {
      return (
        <div className="flex gap-1">
          <AppointmentModal type={"Agendar"} appointment={data} />
          <AppointmentModal type={"Cancelar"} appointment={data} />
        </div>
      );
    },
  },
];
