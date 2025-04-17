import { Client, Account, Databases } from 'node-appwrite';
import type { AppwriteFunctionRequest, AppwriteFunctionResponse } from '@appwrite/frameworks'; 

// Inicializa el SDK con las variables que Appwrite inyecta
const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT!)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
  .setKey(process.env.APPWRITE_FUNCTION_KEY!);

const account   = new Account(client);
const databases = new Databases(client);

export default async function (
  req: AppwriteFunctionRequest,
  res: AppwriteFunctionResponse
) {
  try {
    // 1) Leer passKey del payload
    const { passKey } = JSON.parse(req.payload as string);

    // 2) Recuperar la passKey oficial de la colección Settings
    const settings = await databases.listDocuments(
      process.env.DATABASE_ID!,
      process.env.SETTINGS_COLLECTION_ID!,
      []
    );
    const expected = settings.documents?.[0]?.passKey;

    if (passKey !== expected) {
      return res
        .status(401)
        .json({ error: 'Clave inválida' });
    }

    // 3) Crear el JWT (15min)
    const { jwt } = await account.createJWT();

    // 4) Devolver JSON con el token
    return res
      .status(200)
      .json({ jwt });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: 'Error interno al generar JWT' });
  }
}
