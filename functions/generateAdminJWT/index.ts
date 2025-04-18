import { Client, Account, Databases, Models } from 'node-appwrite';
import { parse } from 'cookie';

interface AppwriteContext {
  req: { headers: Record<string, string>; bodyRaw: Uint8Array };
  env: Record<string, string>;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}
interface FunctionResponse { jwt?: string; error?: string; code?: number; }

const PROJECT_ID     = process.env.APPWRITE_FUNCTION_PROJECT_ID!;
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const DB_ID          = process.env.DATABASE_ID!;
const COLL_ID        = process.env.SETTINGS_COLLECTION_ID!;

export default async function generateAdminJWT(
  context: AppwriteContext
): Promise<FunctionResponse> {
  const { req, env, log, error } = context;
  const text = Buffer.from(req.bodyRaw).toString('utf-8');
  const body = text ? JSON.parse(text) as { passKey?: string } : {};

  const client = new Client()
    .setEndpoint(env.APPWRITE_FUNCTION_ENDPOINT)
    .setProject(env.APPWRITE_FUNCTION_PROJECT_ID);
  const account = new Account(client);

  if (body.passKey) {
    // Validar passKey en la base de datos
    const db = new Databases(client);
    const docs = await db.listDocuments(DB_ID, COLL_ID);
    const validKey = (docs.documents[0] as Models.Document)?.passKey;
    if (body.passKey !== validKey) {
      log('PassKey inválida:', body.passKey);
      return { error: 'Clave inválida', code: 401 };
    }
    log('PassKey válida, autenticando administrador...');
    try {
      // Autenticar admin y generar JWT
      await account.createSession(ADMIN_EMAIL, ADMIN_PASSWORD);
      const jwtRes = await account.createJWT();
      log('JWT generado');
      return { jwt: jwtRes.jwt };
    } catch (e: unknown) {
      error('Error autenticando admin:', e);
      return { error: 'Error autenticando admin', code: 500 };
    }
  }

  // Regenerar JWT desde la cookie de sesión de Appwrite
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
  } catch (e: unknown) {
    error('Error generando JWT:', e);
    return { error: 'Error al generar JWT', code: 500 };
  }
}