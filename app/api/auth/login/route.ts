// app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import { Client, Account } from 'appwrite';
import { cookies } from 'next/headers';

const ENDPOINT = process.env.NEXT_PUBLIC_ENDPOINT as string;
const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID as string;
const FUNCTION_ID = process.env.NEXT_PUBLIC_FUNCTION_ID as string;

interface LoginRequestBody { passKey?: string; }
interface FunctionResponse { jwt?: string; error?: string; code?: number; }

export async function POST(request: Request) {
  const { passKey } = (await request.json()) as LoginRequestBody;
  const cookieStore = await cookies();
  let jwtToken: string;

  if (passKey) {
    // Validar passKey y obtener JWT desde Appwrite Function
    const res = await fetch(
      `${ENDPOINT}/functions/${FUNCTION_ID}/executions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': PROJECT_ID
        },
        body: JSON.stringify({ passKey })
      }
    );
    const payload = (await res.json().catch(() => ({} as FunctionResponse))) as FunctionResponse;
    if (!res.ok || payload.error) {
      return NextResponse.json({ error: payload.error ?? 'Error interno' }, { status: payload.code ?? res.status });
    }
    if (!payload.jwt) {
      return NextResponse.json({ error: 'JWT no generado' }, { status: 500 });
    }
    jwtToken = payload.jwt;
  } else {
    // Regenerar JWT usando la sesión de Appwrite guardada en cookie
    const sessionName = `a_session_${PROJECT_ID}`;
    const sessionValue = cookieStore.get(sessionName)?.value;
    if (!sessionValue) {
      return NextResponse.json({ error: 'Usuario no autenticado' }, { status: 401 });
    }
    const client = new Client()
      .setEndpoint(ENDPOINT)
      .setProject(PROJECT_ID)
      .setSession(sessionValue);
    const account = new Account(client);
    try {
      const jwtRes = await account.createJWT();
      jwtToken = jwtRes.jwt;
    } catch (e: unknown) {
      const error = e as { message?: string; code?: number };
      return NextResponse.json({ error: error.message ?? 'Error generando JWT' }, { status: error.code ?? 500 });
    }
  }

  // Enviar cookie httpOnly con el JWT al cliente
  const response = NextResponse.json({ ok: true });
  response.cookies.set('appwrite_jwt', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'lax'
  });
  return response;
}