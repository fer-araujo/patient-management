import { Client, Functions } from "node-appwrite";

export function getAppwriteClient() {
  const client = new Client();
  client
    .setEndpoint(process.env.NEXT_PUBLIC_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_PROJECT_ID!)
    .setKey(process.env.API_KEY!); // Usa tu API Key privada

  return client;
}

export function getFunctions() {
  return new Functions(getAppwriteClient());
}
