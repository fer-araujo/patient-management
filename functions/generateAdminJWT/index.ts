/// functions/generateAdminJWT/index.ts
import { Client, Account, Databases } from 'node-appwrite';
import { parse } from 'cookie';

interface AppwriteContext {
  req: { headers: Record<string, string>; bodyRaw: Uint8Array };
  env: Record<string, string>;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface FunctionResponse {
  jwt?: string;
  error?: string;
  code?: number;
}

const ENDPOINT       = process.env.APPWRITE_FUNCTION_ENDPOINT!;     // e.g. "https://cloud.appwrite.io/v1"
const PROJECT_ID     = process.env.APPWRITE_FUNCTION_PROJECT_ID!;
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const DB_ID          = process.env.DATABASE_ID!;
const COLL_ID        = process.env.SETTINGS_COLLECTION_ID!;

export default async function generateAdminJWT(
  context: AppwriteContext
): Promise<FunctionResponse> {
  const { req, log, error } = context;
  const text = Buffer.from(req.bodyRaw).toString('utf-8');
  const body = text ? JSON.parse(text) as { passKey?: string } : {};

  const client = new Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID);
  const account = new Account(client);

  if (body.passKey) {
    // Validar passKey en la colección
    const db = new Databases(client);
    const docs = await db.listDocuments(DB_ID, COLL_ID);
    const validKey = docs.documents[0]?.passKey;

    if (body.passKey !== validKey) {
      log('PassKey inválida');
      return { error: 'Clave inválida', code: 401 };
    }
    log('PassKey válida, autenticando administrador...');

    try {
      // Crear sesión de administrador
      await account.createSession(ADMIN_EMAIL, ADMIN_PASSWORD);
      const jwtRes = await account.createJWT();
      log('JWT generado');
      return { jwt: jwtRes.jwt };
    } catch (e) {
      error('Error autenticando admin:', e);
      return { error: 'Error autenticando admin', code: 500 };
    }
  }

  // Regenerar JWT desde cookie de sesión
  const cookiesHeader = req.headers['cookie'] || '';
  const cookiesParsed = parse(cookiesHeader);
  const session = cookiesParsed[`a_session_${PROJECT_ID}`];

  if (!session) {
    return { error: 'Usuario no autenticado', code: 401 };
  }

  try {
    client.setSession(session);
    const jwtRes = await account.createJWT();
    log('JWT regenerado desde sesión');
    return { jwt: jwtRes.jwt };
  } catch (e) {
    error('Error generando JWT:', e);
    return { error: 'Error al generar JWT', code: 500 };
  }
}
