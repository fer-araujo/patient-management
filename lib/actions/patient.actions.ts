import { ID, Query } from "node-appwrite";
import { users } from "../appwrite.config";
import { parseStringify } from "../utils";

export const createUser = async (user: CreateUserParams) => {
  try {
    const newUser = await users.create(
      ID.unique(),
      undefined,
      user.phone,
      undefined,
      user.name
    );

    return parseStringify(newUser);
  } catch (error: unknown) {
    if (error && (error as { code?: number })?.code === 409) {
      const existingUser = await users.list([Query.equal("phone", user.phone)]);

      return existingUser?.users[0];
    }
    console.error("An error occurred while creating a new user:", error);
  }
};
