const { Client, Account, Databases } = require('node-appwrite');

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
  .setKey(process.env.APPWRITE_FUNCTION_KEY);

const account   = new Account(client);
const databases = new Databases(client);

module.exports = async function (req, res) {
  try {
    const { passKey } = JSON.parse(req.payload);
    const settings = await databases.listDocuments(
      process.env.DATABASE_ID,
      process.env.SETTINGS_COLLECTION_ID,
      []
    );
    const expected = settings.documents?.[0]?.passKey;
    if (passKey !== expected) {
      return res.status(401).json({ error: 'Clave inválida' });
    }
    const { jwt } = await account.createJWT();
    return res.json({ jwt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno al generar JWT' });
  }
};
