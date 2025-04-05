import { Models } from "node-appwrite";

export interface Patient extends Models.Document {
  name: string;
  phone: string;
  studyDocument: string[];
}

export interface Appointment extends Models.Document {
  patient: Patient;
  schedule: Date;
  status: Status;
  reason: string;
  note: string;
  userId: string;
  cancellationReason: string | null;
}