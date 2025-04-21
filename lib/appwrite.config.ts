// File: lib/appwrite.config.ts

// — Node SDK imports for server‑side actions —
import { Client as NodeClient, Databases, Storage, Users, Messaging } from "node-appwrite";

// — Web SDK imports for client‑side actions (login, refresh) —
import { Client as WebClient, Account as WebAccount } from "appwrite";

const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID!;
const ENDPOINT   = process.env.NEXT_PUBLIC_ENDPOINT!;

// Tu API Key debe tener al menos scope 'databases.read' y lo que necesites server‑side
const API_KEY    = process.env.API_KEY!;

/**
 * Crea un cliente Node SDK.
 * - Si pasas `jwt`, usa .setJWT(jwt) para actuar como ese usuario.
 * - Si no pasas `jwt`, usa .setKey(API_KEY) para privilegios server.
 */
function createNodeClient(jwt?: string) {
  const client = new NodeClient()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID);

  if (jwt) {
    client.setJWT(jwt);
  } else {
    client.setKey(API_KEY);
  }

  return client;
}

/**
 * Funciones para usar en tus acciones server‑side.
 * Pasa el JWT del usuario para que la llamada respete sus permisos.
 */
export const getDatabases = (jwt?: string) =>
  new Databases(createNodeClient(jwt));

export const getStorage = (jwt?: string) =>
  new Storage(createNodeClient(jwt));

export const getUsers = (jwt?: string) =>
  new Users(createNodeClient(jwt));

export const getMessaging = (jwt?: string) =>
  new Messaging(createNodeClient(jwt));

// — Web SDK setup for client‑side login/refresh —

/**
 * Cliente Web SDK (no key ni jwt).
 * Usado por webAccount para createEmailPasswordSession y createJWT.
 */
export const webClient = new WebClient()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID);

/**
 * Instancia de Account para login/refresh en el cliente
 */
export const webAccount = new WebAccount(webClient);
