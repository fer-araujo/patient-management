import * as nodeSdk from 'node-appwrite';
// Initialize the Appwrite client with environment variables
const nodeClient = new nodeSdk.Client();

nodeClient
.setEndpoint(String(process.env.NEXT_PUBLIC_ENDPOINT)!)
.setProject(String(process.env.NEXT_PUBLIC_PROJECT_ID)!)
.setKey(String(process.env.API_KEY)!);

export const getDatabases = () => new nodeSdk.Databases(nodeClient);
export const getStorage = () => new nodeSdk.Storage(nodeClient);
export const getUsers = () => new nodeSdk.Users(nodeClient);
export const getMessaging = () => new nodeSdk.Messaging(nodeClient);


