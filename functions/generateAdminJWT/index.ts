import { Client, Account as AppwriteAccount, Databases, Models } from 'node-appwrite';

interface AppwriteRequest {
  payload: string;
}
interface AppwriteResponse {
  status(code: number): AppwriteResponse;
  json(body: unknown): void;
}

// Extiende Account para incluir createJWT()
interface AccountWithJWT extends AppwriteAccount {
  createJWT(): Promise<{ jwt: string }>;
}

type SettingsDoc = Models.Document & { passKey: string };

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);

// Aquí indicamos a TS que nuestra cuenta tiene createJWT()
const account = new AppwriteAccount(client) as AccountWithJWT;
const databases = new Databases(client);

export default async function handler(
  req: AppwriteRequest,
  res: AppwriteResponse
) {
  try {
    const { passKey } = JSON.parse(req.payload);
    const settings = await databases.listDocuments<SettingsDoc>(
      process.env.DATABASE_ID!,
      process.env.SETTINGS_COLLECTION_ID!,
      []
    );
    const expected = settings.documents[0].passKey;
    if (passKey !== expected) {
      return res.status(401).json({ error: 'Clave inválida' });
    }

    // Ahora createJWT() es reconocido y tipado correctamente
    const { jwt } = await account.createJWT();

    return res.status(200).json({ jwt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno al generar JWT' });
  }
}
