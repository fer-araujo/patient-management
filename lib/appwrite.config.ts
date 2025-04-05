import * as sdk from 'node-appwrite';
// Initialize the Appwrite client with environment variables
const client = new sdk.Client();

client
.setEndpoint(String(process.env.NEXT_PUBLIC_ENDPOINT)!)
.setProject(String(process.env.PROJECT_ID)!)
.setKey(String(process.env.API_KEY)!);

export const getDatabases = () => new sdk.Databases(client);
export const getStorage = () => new sdk.Storage(client);
export const getUsers = () => new sdk.Users(client);
export const getMessaging = () => new sdk.Messaging(client);
