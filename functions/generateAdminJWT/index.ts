import { Client, Account, Databases, Models } from "node-appwrite";

interface AppwriteContext {
  req: {
    bodyText: string;
    headers: Record<string, string>;
  };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}


type SettingsDoc = Models.Document & { passKey: string };

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);

const account = new Account(client) as unknown as {
  createJWT(): Promise<{ jwt: string }>;
};

const databases = new Databases(client);

export default async function generateAdminJWT(context: AppwriteContext) {
  const { req, log, error } = context;

  try {
    const bodyText = req.headers?.["x-fn-body"] || "";

    if (!bodyText) {
      log("❌ bodyText está vacío");
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
    log("🗄️ passKey esperada:", expected);

    if (passKey !== expected) {
      log("❌ passKey inválida");
      return { error: "Clave inválida", code: 401 };
    }

    const { jwt } = await account.createJWT();
    log("✅ JWT generado");

    return { jwt };
  } catch (err) {
    error("🔥 Error interno:", err);
    return { error: "Error interno al generar JWT", code: 500 };
  }
}
