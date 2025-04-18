// File: app/api/auth/login/route.ts
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
    // 1) Llamada REST síncrona a la Function
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
    const exec = (await response.json()) as Record<string, unknown>;

    // Extraer respuesta cruda y estado interno
    const raw = (exec.responseBody ?? exec.response) as string || '';
    const status = (exec.statusCode ?? exec.responseStatusCode ?? response.status) as number;

    // HTTP error
    if (!response.ok) {
      return NextResponse.json({ error: raw || 'Error interno' }, { status: response.status });
    }

    // Error desde la Function
    if (status < 200 || status >= 300) {
      let msg = 'Error interno';
      try { msg = JSON.parse(raw).error; } catch {}
      return NextResponse.json({ error: msg }, { status });
    }

    // Parseo del JWT
    let result: FunctionResult;
    try {
      result = JSON.parse(raw) as FunctionResult;
    } catch {
      return NextResponse.json({ error: 'Respuesta inválida de la función', raw }, { status: 500 });
    }
    if (!result.jwt) {
      return NextResponse.json({ error: result.error ?? 'JWT no generado' }, { status: 500 });
    }
    jwtToken = result.jwt;

  } else {
    // 2) Regenera JWT desde la cookie de sesión de Appwrite
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
    const jwtRes = await account.createJWT();
    jwtToken = jwtRes.jwt;
  }

  // 3) Envía cookie httpOnly con el JWT
  const response = NextResponse.json({ ok: true });
  response.cookies.set('appwrite_jwt', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'lax',
  });
  return response;
}

