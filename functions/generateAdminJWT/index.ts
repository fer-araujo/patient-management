// functions/generateAdminJWT/index.ts

import { Client, Account, Databases, Models } from 'node-appwrite';

//
// Definimos el contexto que Appwrite inyecta en Node.js 20
//
interface AppwriteContext {
  req: {
    // El body viene como texto
    bodyText: string;
  };
  res: {
    status(code: number): AppwriteContext['res'];
    json(body: unknown): void;
  };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

//
// Documento de Settings con passKey
//
type SettingsDoc = Models.Document & { passKey: string };

//
// Inicialización del SDK de Appwrite
//
const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);

// Aseguramos el tipo de createJWT()
const account = new Account(client) as unknown as {
  createJWT(): Promise<{ jwt: string }>;
};
const databases = new Databases(client);

//
// Handler único
//
export default async function generateAdminJWT(context: AppwriteContext): Promise<void> {
  const { req, res, log, error } = context;
  try {
    // 1) Leer payload
    const { passKey } = JSON.parse(req.bodyText);
    log('🔑 passKey recibida:', passKey);

    // 2) Obtener passKey oficial
    const result = await databases.listDocuments<SettingsDoc>(
      process.env.DATABASE_ID!,
      process.env.SETTINGS_COLLECTION_ID!,
      []
    );
    const expected = result.documents?.[0]?.passKey;
    log('🗄️ passKey esperada:', expected);

    if (passKey !== expected) {
      log('❌ passKey inválida');
      res.status(401).json({ error: 'Clave inválida' });
      return;
    }

    // 3) Generar JWT
    const { jwt } = await account.createJWT();
    log('✅ JWT generado');

    // 4) Responder al caller
    res.status(200).json({ jwt });
  } catch (err) {
    error('🔥 Error interno:', err);
    res.status(500).json({ error: 'Error interno al generar JWT' });
  }
}
