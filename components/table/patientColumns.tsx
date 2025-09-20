"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Patient, StudyFile } from "@/types/appwrite.types";
import { formatPhoneNumber } from "@/lib/utils";
import StudiesModal from "../StudiesModal";
import PatientActionCell from "./cells/PatientActionCell";

export const patientColumns: ColumnDef<Patient>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
    cell: ({ row }) => {
      const name = row.original.name;
      return <p className="text-sm font-light">{name}</p>;
    },
  },
  {
    accessorKey: "phone",
    header: "Teléfono",
    cell: ({ row }) => {
      const phone = row.original.phone;
      return <p className="text-sm font-light">{formatPhoneNumber(phone)}</p>;
    },
  },
  {
    accessorKey: "studies",
    header: "Estudios",
    cell: ({ row }) => {
      const studies = row.original.studyFiles;
      const studiesList = studies ? studies
        .sort((a: StudyFile, b: StudyFile) => new Date(b.$createdAt).getTime() - new Date(a.$createdAt).getTime())
        .map((study: StudyFile) => ({ id: study.fileId })) : [];
      const button =
        studiesList.length > 0 ? (
          <StudiesModal
            studies={studiesList}
            patientName={row.original.name}
          />
        ) : (
          <p className="text-sm font-light">No hay estudios</p>
        );
      return button;
    },
  },
  {
    id: "actions",
    header: () => <div className="pl-4">Acciones</div>,
    cell: ({ row: { original: data } }) => {
      return <PatientActionCell patient={data} />;
    },
  },
];