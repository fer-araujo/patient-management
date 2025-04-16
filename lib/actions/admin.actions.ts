"use server";

import { getDatabases  } from "../appwrite.config";

export const getAdminPassKey = async () => {
  const db = getDatabases();
  const res = await db.listDocuments(
    process.env.DATABASE_ID!,
    process.env.SETTINGS_COLLECTION_ID!,
    []
  );

  return res.documents?.[0]?.passKey ?? null;
};
