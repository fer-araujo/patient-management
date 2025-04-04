
import * as sdk from 'node-appwrite';
// Initialize the Appwrite client with environment variables
const client = new sdk.Client();

client
.setEndpoint(String(process.env.NEXT_PUBLIC_ENDPOINT)!)
.setProject(String(process.env.NEXT_PUBLIC_PROJECT_ID)!)
.setKey(String(process.env.NEXT_PUBLIC_API_KEY)!);

export const databases = new sdk.Databases(client);
export const storage = new sdk.Storage(client);
export const users = new sdk.Users(client);
export const messaging = new sdk.Messaging(client);