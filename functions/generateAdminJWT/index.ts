// functions/generateAdminJWT/index.ts

import { Client, Databases, Models } from "node-appwrite";

interface AppwriteContext {
  req: { bodyRaw: Uint8Array };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

type SettingsDoc = Models.Document & { passKey: string };

const ENDPOINT       = process.env.APPWRITE_FUNCTION_ENDPOINT!;     // e.g. "https://cloud.appwrite.io/v1"
const PROJECT_ID     = process.env.APPWRITE_FUNCTION_PROJECT_ID!;
const API_KEY        = process.env.APPWRITE_FUNCTION_KEY!;         // tu API Key UI con scopes: account, sessions.write, databases.read
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const DB_ID          = process.env.DATABASE_ID!;
const COLL_ID        = process.env.SETTINGS_COLLECTION_ID!;

const client    = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

export default async function generateAdminJWT(context: AppwriteContext) {
  const { req, log, error } = context;

  try {
    // 1) Leer passKey del body
    const bodyText = Buffer.from(req.bodyRaw || []).toString("utf-8");
    if (!bodyText) {
      log("❌ Petición vacía");
      return { error: "Petición vacía", code: 400 };
    }
    const { passKey } = JSON.parse(bodyText) as { passKey: string };
    log("🔑 passKey recibida:", passKey);

    // 2) Validar passKey en la colección Settings
    const res = await databases.listDocuments<SettingsDoc>(DB_ID, COLL_ID, []);
    const expected = res.documents?.[0]?.passKey;
    if (passKey !== expected) {
      log("❌ passKey inválida:", passKey, "vs", expected);
      return { error: "Clave inválida", code: 401 };
    }
    log("✅ passKey correcta, creando sesión de admin…");

    // 3) Crear sesión de admin por REST
    let r = await fetch(`${ENDPOINT}/account/sessions/email`, {
      method: "POST",
      headers: {
        "Content-Type":       "application/json",
        "X-Appwrite-Project": PROJECT_ID,
        "X-Appwrite-Key":     API_KEY,
      },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!r.ok) {
      const txt = await r.text();
      log("❌ fallo al crear sesión:", txt);
      return { error: "Credenciales inválidas", code: 401 };
    }
    log("✅ Sesión de admin creada");

    // 4) Generar JWT de esa sesión por REST
    r = await fetch(`${ENDPOINT}/account/jwt`, {
      method: "POST",
      headers: {
        "Content-Type":       "application/json",
        "X-Appwrite-Project": PROJECT_ID,
        "X-Appwrite-Key":     API_KEY,
      },
    });
    if (!r.ok) {
      const txt = await r.text();
      log("❌ fallo al generar JWT:", txt);
      return { error: "No se pudo generar JWT", code: 500 };
    }
    const { jwt } = await r.json();
    log("✅ JWT generado:", jwt);

    return { jwt };
  } catch (err) {
    error("🔥 Error interno al generar JWT:", err);
    return { error: "Error interno al generar JWT", code: 500 };
  }
}
