import { Client, Databases, Models } from "node-appwrite";

interface AppwriteContext {
  req: { bodyRaw: Uint8Array };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

type SettingsDoc = Models.Document & { passKey: string };

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);
  console.log(process.env.APPWRITE_FUNCTION_KEY!)
const databases = new Databases(client);

export default async function generateAdminJWT(context: AppwriteContext) {
  const { req, log, error } = context;

  try {
    // 1) Leer el bodyRaw y convertirlo
    const bodyText = Buffer.from(req.bodyRaw || []).toString("utf-8");
    if (!bodyText) {
      log("❌ bodyText vacío");
      return { error: "Petición vacía", code: 400 };
    }
    const { passKey } = JSON.parse(bodyText);
    log("🔑 passKey recibida (string):", passKey);

    // 2) Obtener el documento de Settings
    const result = await databases.listDocuments<SettingsDoc>(
      process.env.DATABASE_ID!,
      process.env.SETTINGS_COLLECTION_ID!,
      []
    );

    // 3) Log completo de documentos
    log("🗄️ documents:", JSON.stringify(result.documents));

    // 4) Extraer y loguear el passKey esperado
    const rawExpected = result.documents[0]?.passKey;
    log(`🗄️ rawExpected (tipo ${typeof rawExpected}):`, rawExpected);
    const expected = String(rawExpected);
    log("🗄️ expected (string):", expected);

    // 5) Comparar
    if (passKey !== expected) {
      log("❌ passKey inválida (recibida:", passKey, "vs esperada:", expected, ")");
      return { error: "Clave inválida", code: 401 };
    }

    log("✅ passKey correcta, generando JWT...");

    // 6) Generar JWT
    const jwtRes = await fetch(
      `${process.env.APPWRITE_FUNCTION_ENDPOINT}/account/jwt`,
      {
        method: "POST",
        headers: {
          "Content-Type":       "application/json",
          "X-Appwrite-Project": process.env.APPWRITE_FUNCTION_PROJECT_ID!,
          "X-Appwrite-Key":     process.env.APPWRITE_FUNCTION_KEY!,
        },
      }
    );

    if (!jwtRes.ok) {
      const text = await jwtRes.text();
      log("❌ Error al generar JWT:", text);
      return { error: "No se pudo generar JWT", code: jwtRes.status };
    }

    const { jwt } = await jwtRes.json();
    log("✅ JWT generado:", jwt);
    return { jwt };
  } catch (err) {
    error("🔥 Error interno:", err);
    return { error: "Error interno al generar JWT", code: 500 };
  }
}
