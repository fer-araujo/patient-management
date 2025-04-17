// functions/generateAdminJWT/index.ts

import { Client, Account, Databases, Models } from "appwrite";

interface AppwriteContext {
  req: { bodyRaw: Uint8Array };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

type SettingsDoc = Models.Document & { passKey: string };

const ENDPOINT       = process.env.APPWRITE_FUNCTION_ENDPOINT!;     // e.g. "https://cloud.appwrite.io/v1"
const PROJECT_ID     = process.env.APPWRITE_FUNCTION_PROJECT_ID!; 
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL!;                  
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;               
const DB_ID          = process.env.DATABASE_ID!;                  
const COLL_ID        = process.env.SETTINGS_COLLECTION_ID!;       

// Inicializamos el client con la Web SDK
const client = new Client()
  .setEndpoint(ENDPOINT)  
  .setProject(PROJECT_ID)

const account   = new Account(client);
const databases = new Databases(client);

export default async function generateAdminJWT(context: AppwriteContext) {
  const { req, log, error } = context;

  try {
    // 1) Leer y parsear el passKey del body
    const bodyText = Buffer.from(req.bodyRaw || []).toString("utf-8");
    if (!bodyText) {
      log("❌ Petición vacía");
      return { error: "Petición vacía", code: 400 };
    }
    const { passKey } = JSON.parse(bodyText) as { passKey: string };
    log("🔑 passKey recibida:", passKey);

    // 2) Validar passKey leyendo tu colección Settings
    const settingsRes = await databases.listDocuments<SettingsDoc>(
      DB_ID,
      COLL_ID,
      []
    );
    const expected = settingsRes.documents?.[0]?.passKey;
    if (passKey !== expected) {
      log("❌ passKey inválida:", passKey, "vs", expected);
      return { error: "Clave inválida", code: 401 };
    }
    log("✅ passKey correcta, creando sesión de admin…");

    // 3) Crear sesión de admin (email+password)
    await account.createEmailPasswordSession(ADMIN_EMAIL, ADMIN_PASSWORD);
    log("✅ Sesión de admin creada");

    // 4) Generar JWT de esa sesión
    const jwtRes = await account.createJWT(); // :contentReference[oaicite:1]{index=1}
    const jwt = jwtRes.jwt;
    log("✅ JWT generado:", jwt);

    return { jwt };
  } catch (err) {
    error("🔥 Error interno:", err);
    return { error: "Error interno al generar JWT", code: 500 };
  }
}
