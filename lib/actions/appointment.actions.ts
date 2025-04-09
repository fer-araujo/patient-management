"use server";
import { ID } from "node-appwrite";
import { getDatabases } from "../appwrite.config";
import { parseStringify } from "../utils";


export const registerApointment = async (appointment: CreateAppointmentParams) => {
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
}

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
}