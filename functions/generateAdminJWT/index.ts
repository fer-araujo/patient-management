import { Client, Users, Databases, Models } from "node-appwrite";

interface AppwriteContext {
  req: {
    bodyRaw: Uint8Array;
  };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

type SettingsDoc = Models.Document & { passKey: string };

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);

const users = new Users(client);
const databases = new Databases(client);

export default async function generateAdminJWT(context: AppwriteContext) {
  const { req, log, error } = context;

  try {
    const bodyText = Buffer.from(req.bodyRaw || []).toString("utf-8");

    if (!bodyText) {
      log("❌ bodyText vacío");
      return { error: "Petición vacía", code: 400 };
    }

    const { passKey } = JSON.parse(bodyText);
    log("🔑 passKey recibida:", passKey);

    const result = await databases.listDocuments<SettingsDoc>(
      process.env.DATABASE_ID!,
      process.env.SETTINGS_COLLECTION_ID!,
      []
    );

    const expected = result.documents[0]?.passKey;

    if (passKey !== expected) {
      log("❌ passKey inválida");
      return { error: "Clave inválida", code: 401 };
    }

    log("✅ passKey correcta");

    // ✅ Generar JWT con permisos de admin sin login explícito
    const jwtResult = await users.createJWT(process.env.ADMIN_USER_ID!);
    log("✅ JWT generado para el admin");

    return { jwt: jwtResult.jwt };
  } catch (err) {
    error("🔥 Error interno:", err);
    return { error: "Error interno al generar JWT", code: 500 };
  }
}
