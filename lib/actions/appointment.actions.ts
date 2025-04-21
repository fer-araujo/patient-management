"use server";
import { ID, Query } from "node-appwrite";
import { getDatabases } from "../appwrite.config";
import { parseStringify } from "../utils";
import { Appointment } from "@/types/appwrite.types";
import { CreateAppointmentParams, UpdateAppointmentParams } from "@/types";
import { revalidatePath } from "next/cache";

export const registerAppointment = async (
  appointment: CreateAppointmentParams
) => {
  try {
    const databases = getDatabases();

    const appointmentDoc = await databases.createDocument(
      process.env.DATABASE_ID!,
      process.env.APPOINTMENT_COLLECTION_ID!,
      ID.unique(),
      appointment
    );

    return parseStringify(appointmentDoc);
  } catch (error) {
    console.error("Error creating appointment:", error);
  }
};

export const getAppointmentById = async (appointmentId: string) => {
  try {
    const databases = getDatabases();

    const appointmentDoc = await databases.getDocument(
      process.env.DATABASE_ID!,
      process.env.APPOINTMENT_COLLECTION_ID!,
      appointmentId
    );

    return parseStringify(appointmentDoc);
  } catch (error) {
    console.error("Error fetching appointment:", error);
  }
};

export const getRecentAppointmentList = async (jwt: string) => {

  try {
    const databases = getDatabases(jwt);

    const appointmentList = await databases.listDocuments(
      process.env.DATABASE_ID!,
      process.env.APPOINTMENT_COLLECTION_ID!,
      [Query.orderDesc("$createdAt")]
    );

   const counts = (appointmentList.documents as Appointment[]).reduce(
    (acc, appt) => {
      if (appt.status === 'scheduled') acc.scheduledCount++;
      if (appt.status === 'pending')   acc.pendingCount++;
      if (appt.status === 'cancelled') acc.cancelledCount++;
      return acc;
    },
    { scheduledCount: 0, pendingCount: 0, cancelledCount: 0 }
  );

    const data = {
      totalCount: appointmentList.total,
      ...counts,
      documents: appointmentList.documents,
    };

    return parseStringify(data);
  } catch (error) {
    console.error("Error fetching appointment list:", error);
  }
};

export const updateAppointment = async (
  appointment: UpdateAppointmentParams
) => {
  try {
    const databases = getDatabases();
    const { appointmentId, ...updateData } = appointment;
    const appointmentDoc = await databases.updateDocument(
      process.env.DATABASE_ID!,
      process.env.APPOINTMENT_COLLECTION_ID!,
      appointmentId,
      updateData
    );
    revalidatePath("/admin");
    return parseStringify(appointmentDoc);
  } catch (error) {
    console.error("Error updating appointment:", error);
  }
};
