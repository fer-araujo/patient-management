// File: functions/generateAdminJWT/index.ts
import sdk from 'node-appwrite';
import { parse } from 'cookie';

interface AppwriteContext {
  req: { headers: Record<string, string>; bodyRaw: Uint8Array };
  env: Record<string, string>;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// Variables de entorno inyectadas por Appwrite Functions
const ENDPOINT       = process.env.APPWRITE_FUNCTION_ENDPOINT!;
const PROJECT_ID     = process.env.APPWRITE_FUNCTION_PROJECT_ID!;
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const DB_ID          = process.env.DATABASE_ID!;
const COLL_ID        = process.env.SETTINGS_COLLECTION_ID!;
const API_KEY        = process.env.APPWRITE_FUNCTION_API_KEY!;

export default async function generateAdminJWT(context: AppwriteContext) {
  const { req, log, error } = context;

  // Parsear body
  const text = Buffer.from(req.bodyRaw).toString('utf-8');
  const body = text ? JSON.parse(text) as { passKey?: string } : {};

  const client = new sdk.Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(API_KEY);
  const account = new sdk.Account(client);
  const databases = new sdk.Databases(client);

  try {
    if (body.passKey) {
      // Validar passKey
      const docs = await databases.listDocuments(DB_ID, COLL_ID, []);
      const validKey = (docs.documents[0] as any)?.passKey;
      if (body.passKey !== validKey) {
        log('PassKey inválida');
        return { statusCode: 401, body: JSON.stringify({ error: 'Clave inválida' }) };
      }
      log('PassKey válida, autenticando admin...');

      // Crear sesión de admin y generar JWT
      await account.createSession(ADMIN_EMAIL, ADMIN_PASSWORD);
      const jwtRes = await account.createJWT();
      log('JWT generado');
      return { statusCode: 200, body: JSON.stringify({ jwt: jwtRes.jwt }) };
    }

    // Regenerar JWT desde cookie
    const cookiesHeader = req.headers['cookie'] || '';
    const parsed = parse(cookiesHeader);
    const session = parsed[`a_session_${PROJECT_ID}`];
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Usuario no autenticado' }) };
    }
    client.setSession(session);
    const jwtRes = await account.createJWT();
    log('JWT regenerado');
    return { statusCode: 200, body: JSON.stringify({ jwt: jwtRes.jwt }) };

  } catch (e: any) {
    error('Error interno:', e);
    return { statusCode: e.code || 500, body: JSON.stringify({ error: e.message || 'Error interno' }) };
  }
}
