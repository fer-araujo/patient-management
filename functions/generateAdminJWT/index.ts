// functions/generateAdminJWT/index.ts

import { Client, Databases, Models, Users } from "node-appwrite";

interface AppwriteContext {
  req: { bodyRaw: Uint8Array };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

type SettingsDoc = Models.Document & { passKey: string };

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)      // e.g. "https://cloud.appwrite.io/v1"
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)     // tu projectId
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);               // la Service Key inyectada (tiene todos los scopes)

const databases = new Databases(client);
const users     = new Users(client);                         // para crear JWT de cualquier usuario

export default async function generateAdminJWT(context: AppwriteContext) {
  const { req, log, error } = context;

  try {
    // 1) Leer y parsear el body
    const bodyText = Buffer.from(req.bodyRaw || []).toString("utf-8");
    if (!bodyText) {
      log("❌ Petición vacía");
      return { error: "Petición vacía", code: 400 };
    }
    const { passKey } = JSON.parse(bodyText) as { passKey: string };
    log("🔑 passKey recibida:", passKey);

    // 2) Validar passKey contra tu colección Settings
    const settingsResult = await databases.listDocuments<SettingsDoc>(
      process.env.DATABASE_ID!,
      process.env.SETTINGS_COLLECTION_ID!,
      []
    );
    const expected = settingsResult.documents?.[0]?.passKey;
    if (passKey !== expected) {
      log("❌ passKey inválida (recibida vs esperada):", passKey, expected);
      return { error: "Clave inválida", code: 401 };
    }

    log("✅ passKey correcta, generando JWT de admin...");

    // 3) Generar el JWT para el admin con Users.createJWT()
    const { jwt } = await users.createJWT(process.env.ADMIN_USER_ID!);

    log("✅ JWT generado:", jwt);
    return { jwt };

  } catch (err) {
    error("🔥 Error interno al generar JWT:", err);
    return { error: "Error interno al generar JWT", code: 500 };
  }
}
