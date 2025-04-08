"use server";

import { InputFile } from "node-appwrite/file";
import { getDatabases, getStorage } from "../appwrite.config";
import { ID, Query } from "node-appwrite";
import { parseStringify } from "../utils";

export const registerPatient = async ({ studyDocument, ...patient }: CreatePatientParams) => {
  try {
    const databases = getDatabases();
    const storage = getStorage();

    const patientDoc = await databases.createDocument(
      process.env.DATABASE_ID!,
      process.env.PATIENT_COLLECTION_ID!,
      ID.unique(),
      patient
    );

    const patientId = patientDoc.$id;

    if (studyDocument && studyDocument instanceof FormData) {
      const blobs = studyDocument.getAll("blobFile") as Blob[];
      const names = studyDocument.getAll("fileName") as string[];

      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        const fileName = names[i];

        if (blob && fileName) {
          const inputFile = InputFile.fromBuffer(blob, fileName);
          const file = await storage.createFile(
            process.env.BUCKET_ID!,
            ID.unique(),
            inputFile
          );

          const fileId = file.$id;
          const fileUrl = `${process.env.NEXT_PUBLIC_ENDPOINT}/storage/buckets/${process.env.BUCKET_ID}/files/${fileId}/view?project=${process.env.PROJECT_ID}`;

          await databases.createDocument(
            process.env.DATABASE_ID!,
            process.env.STUDY_FILES_COLLECTION_ID!,
            ID.unique(),
            {
              fileId,
              fileUrl,
              fileName,
              patientId,
            }
          );
        }
      }
    }

    return parseStringify(patientDoc);
  } catch (error) {
    console.error("Error creating patient:", error);
  }
};

export const getPatientByPhone = async (phone: string) => {
  try {
    const databases = getDatabases();
    const res = await databases.listDocuments(
      process.env.DATABASE_ID!,
      process.env.PATIENT_COLLECTION_ID!,
      [Query.equal("phone", phone)] // Usa Query de Appwrite
    );

    return res.documents[0]; // retorna el primer paciente encontrado
  } catch (error) {
    console.error("Error fetching patient:", error);
    return null;
  }
};

