import { Client, Databases, Models } from "node-appwrite";

interface AppwriteContext {
  req: { bodyRaw: Uint8Array; };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

type SettingsDoc = Models.Document & { passKey: string };

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);

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

    log("✅ passKey correcta, generando JWT...");

    // —————— Aquí la corrección: llamamos al endpoint /account/jwt ——————
    const jwtRes = await fetch(
      `${process.env.APPWRITE_FUNCTION_ENDPOINT}/v1/account/jwt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": process.env.APPWRITE_FUNCTION_PROJECT_ID!,
          "X-Appwrite-Key":     process.env.APPWRITE_FUNCTION_KEY!,
        },
      }
    );

    if (!jwtRes.ok) {
      const text = await jwtRes.text();
      log("❌ Error al generar JWT:", text);
      return { error: "No se pudo generar el JWT del admin", code: jwtRes.status };
    }

    const { jwt } = await jwtRes.json();
    log("✅ JWT generado:", jwt);

    return { jwt };
  } catch (err) {
    error("🔥 Error interno:", err);
    return { error: "Error interno al generar JWT", code: 500 };
  }
}
