// lib/appwrite.config.ts
import { Client, Account, Databases, Storage, Users, Messaging } from "node-appwrite";

// Crea un cliente Appwrite usando API Key (server) o JWT (admin)
function createClient(jwt?: string) {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_PROJECT_ID!);

  if (jwt) {
    client.setJWT(jwt);
  } else {
    client.setKey(process.env.API_KEY!);
  }

  return client;
}

// Exporta account para operaciones de usuario (e.g., createJWT)
export const account = new Account(createClient());

// Resto de servicios (pueden tomar jwt si es necesario)
export const getDatabases = (jwt?: string) => new Databases(createClient(jwt));
export const getStorage   = (jwt?: string) => new Storage(createClient(jwt));
export const getUsers     = (jwt?: string) => new Users(createClient(jwt));
export const getMessaging = (jwt?: string) => new Messaging(createClient(jwt));
