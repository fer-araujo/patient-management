// app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import { Client, Account } from 'appwrite';
import { cookies } from 'next/headers';

// ENDPOINT es tu base URL de Appwrite (e.g. https://<REGION>.appwrite.io/v1)
const ENDPOINT = process.env.NEXT_PUBLIC_ENDPOINT as string;
const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID as string;
const FUNCTION_ID = process.env.NEXT_PUBLIC_FUNCTION_ID as string;

interface LoginRequestBody { passKey?: string; }
interface FunctionResult { jwt?: string; error?: string; }

export async function POST(request: Request) {
  const { passKey } = (await request.json()) as LoginRequestBody;
  let jwtToken: string;

  if (passKey) {
    // Llamada REST síncrona a la Function
    const response = await fetch(
      `${ENDPOINT}/functions/${FUNCTION_ID}/executions?async=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': PROJECT_ID,
        },
        body: JSON.stringify({ passKey }),
      }
    );
    const exec = await response.json();

    // HTTP error
    if (!response.ok) {
      const msg = exec.response ?? 'Error interno';
      return NextResponse.json({ error: msg }, { status: response.status });
    }

    // Revisa el status de la ejecución dentro de la Function
    const funcStatus = exec.responseStatusCode as number | undefined;
    if (typeof funcStatus === 'number' && (funcStatus < 200 || funcStatus >= 300)) {
      let msg = 'Error interno';
      try { msg = JSON.parse(exec.response).error; } catch {}
      return NextResponse.json({ error: msg }, { status: funcStatus });
    }

    // Parsea el payload
    let result: FunctionResult;
    try {
      result = JSON.parse(exec.response) as FunctionResult;
    } catch {
      return NextResponse.json(
        { error: 'Respuesta inválida de la función', raw: exec.response },
        { status: 500 }
      );
    }

    if (!result.jwt) {
      return NextResponse.json({ error: result.error ?? 'JWT no generado' }, { status: 500 });
    }
    jwtToken = result.jwt;

  } else {
    // Regenera JWT desde la cookie de sesión Appwrite
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(`a_session_${PROJECT_ID}`)?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Usuario no autenticado' }, { status: 401 });
    }
    const client = new Client()
      .setEndpoint(ENDPOINT)
      .setProject(PROJECT_ID)
      .setSession(sessionCookie);
    const account = new Account(client);
    try {
      const jwtRes = await account.createJWT();
      jwtToken = jwtRes.jwt;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error generando JWT';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Envía cookie httpOnly con el JWT
  const nextResponse = NextResponse.json({ ok: true });
  nextResponse.cookies.set('appwrite_jwt', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'lax',
  });
  return nextResponse;
}