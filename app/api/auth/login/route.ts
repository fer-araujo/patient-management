// app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import { Client, Account } from 'appwrite';
import { cookies } from 'next/headers';

const ENDPOINT = process.env.NEXT_PUBLIC_ENDPOINT as string;
const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID as string;
const FUNCTION_ID = process.env.NEXT_PUBLIC_FUNCTION_ID as string;

interface LoginRequestBody { passKey?: string; }

export async function POST(request: Request) {
  const { passKey } = (await request.json()) as LoginRequestBody;
  // cookies() devuelve una promesa en este contexto
  const cookieStore = await cookies();
  let jwtToken: string;

  if (passKey) {
    // Llamada a Appwrite Function para validar passKey y generar JWT
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

    if (!res.ok) {
      const payload = await res.json().catch(() => ({} as Record<string, unknown>));
      return NextResponse.json(
        { error: payload.error ?? 'Error interno' },
        { status: res.status }
      );
    }

    const data = (await res.json()) as { jwt: string };
    jwtToken = data.jwt;
  } else {
    // Regenerar JWT desde la cookie de sesión de Appwrite
    const sessionName = `a_session_${PROJECT_ID}`;
    const sessionValue = cookieStore.get(sessionName)?.value;
    if (!sessionValue) {
      return NextResponse.json(
        { error: 'Usuario no autenticado' },
        { status: 401 }
      );
    }

    const client = new Client()
      .setEndpoint(ENDPOINT)
      .setProject(PROJECT_ID)
      .setSession(sessionValue);
    const account = new Account(client);

    const jwtResponse = await account.createJWT();
    jwtToken = jwtResponse.jwt;
  }

  // Setear la cookie httpOnly con el JWT
  const response = NextResponse.json({ ok: true });
  response.cookies.set('appwrite_jwt', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'lax'
  });
  return response;
}