// app/api/auth/login/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { passKey } = await request.json();
  const endpoint   = process.env.NEXT_PUBLIC_ENDPOINT!;
  const projectId  = process.env.NEXT_PUBLIC_PROJECT_ID!;
  const functionId = process.env.NEXT_PUBLIC_FUNCTION_ID!;

  // Llamada síncrona a la Function
  const execRes = await fetch(
    `${endpoint}/functions/${functionId}/executions?sync=true`,
    {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-Appwrite-Project': projectId,
      },
      body: JSON.stringify({ passKey }),
    }
  );

  // Si la Function devolvió 4xx/5xx, abortamos
  if (!execRes.ok) {
    return new NextResponse('Credenciales inválidas', { status: 401 });
  }

  // Parseamos el “envoltorio” del resultado
  const execJson = await execRes.json();
  console.log('⚙️ execJson:', execJson);

  // Aquí puede venir: execJson.responseBody o execJson.response
  const raw = execJson.responseBody ?? execJson.response;

  // Si raw está vacío, abortamos
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    console.error('❌ Function devolvió body vacío:', raw);
    return new NextResponse('Error interno al generar token', { status: 500 });
  }

  // Intentamos parsear sólo ahora
  let data: { jwt: string };
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('❌ JSON.parse falló en raw:', raw, err);
    return new NextResponse('Error interno al interpretar token', { status: 500 });
  }

  const { jwt } = data;

  // Guardamos la cookie HttpOnly
  const response = NextResponse.json({ ok: true });
  response.cookies.set('appwrite_jwt', jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return response;
}
