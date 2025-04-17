import { NextResponse } from "next/server";
import { getFunctions } from "@/lib/appwriteServer";

export async function POST(request: Request) {
  const { passKey } = await request.json();

  try {
    const functions = getFunctions();

    const result = await functions.createExecution(
      process.env.NEXT_PUBLIC_FUNCTION_ID!,
      JSON.stringify({ passKey }),
      true // sync=true
    );

    const output = result.responseBody;

    if (!output) {
      console.error("❌ output vacío desde Function", result);
      return new NextResponse("Error interno al generar token", { status: 500 });
    }

    const parsed = JSON.parse(output);

    if (parsed.error) {
      return new NextResponse(parsed.error, { status: parsed.code });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set("appwrite_jwt", parsed.jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("🔥 Error en ejecución de función:", err);
    return new NextResponse("Error de servidor", { status: 500 });
  }
}
