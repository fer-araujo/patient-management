import { Models } from "node-appwrite";
import { Status } from ".";

export interface StudyFile extends Models.Document {
  fileId: string;
  fileUrl: string;
  fileName: string;
  patientId: string;
}

export interface Patient extends Models.Document {
  name: string;
  phone: string;
  studyDocument: FormData | undefined;
  studyFiles?: StudyFile[];
}

export interface Appointment extends Models.Document {
  patient: Patient;
  schedule: Date;
  status: Status;
  reason: string;
  cancellationReason: string | null;
}

export type ActionMapValue =
| { primary: string; secondary?: string }
| { text: string };
