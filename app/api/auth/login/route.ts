// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { getFunctions } from "@/lib/appwriteServer";

export async function POST(request: Request) {
  // 1) Extraemos la passKey que envía el frontend
  const { passKey } = await request.json();

  try {
    // 2) Invocamos tu Appwrite Function en modo síncrono
    const functions = getFunctions();
    const exec = await functions.createExecution(
      process.env.NEXT_PUBLIC_FUNCTION_ID!,      // ID de tu función
      JSON.stringify({ passKey }),               // Body que espera la Function
      true                                       // sync = true
    );

    // 3) Leemos el cuerpo de la ejecución
    const output = exec.responseBody;
    if (!output) {
      console.error("❌ output vacío desde Function", exec);
      return new NextResponse("Error interno al generar token", { status: 500 });
    }

    // 4) Parseamos y manejamos errores de validación o login
    const parsed = JSON.parse(output);
    if (parsed.error) {
      return new NextResponse(parsed.error, { status: parsed.code });
    }

    // 5) Si todo va bien, seteamos la cookie con el JWT
    const response = NextResponse.json({ ok: true });
    response.cookies.set("appwrite_jwt", parsed.jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return response;

  } catch (err) {
    console.error("🔥 Error en ejecución de Function:", err);
    return new NextResponse("Error de servidor", { status: 500 });
  }
}
