// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { account, getDatabases } from "@/lib/appwrite.config";

export async function POST(request: Request) {
  const { passKey } = await request.json();

  // 1) Obtener passKey real de la colección de Settings
  const db = getDatabases(); 
  const result = await db.listDocuments(
    process.env.DATABASE_ID!,
    process.env.SETTINGS_COLLECTION_ID!,
    []
  );
  const expectedPassKey = result.documents?.[0]?.passKey;

  if (passKey !== expectedPassKey) {
    return new NextResponse("Credenciales inválidas", { status: 401 });
  }

  // 2) Generar el JWT (sin parámetros)
  const { jwt } = await account.createJWT();

  // 3) Enviar respuesta y setear cookie HttpOnly
  const response = NextResponse.json({ ok: true });
  response.cookies.set("appwrite_jwt", jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}
