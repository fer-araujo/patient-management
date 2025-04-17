// app/api/auth/login/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { passKey } = await request.json();
  const endpoint   = process.env.NEXT_PUBLIC_ENDPOINT!;
  const projectId  = process.env.NEXT_PUBLIC_PROJECT_ID!;
  const functionId = process.env.NEXT_PUBLIC_FUNCTION_ID!;

  const execRes = await fetch(
    `${endpoint}/functions/${functionId}/executions?sync=true`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': projectId,
      },
      body: JSON.stringify({ passKey }),
    }
  );

  if (!execRes.ok) {
    return new NextResponse('Credenciales inválidas', { status: 401 });
  }

  const execJson = await execRes.json();
  const output   = execJson.responseBody ?? execJson.response;
  const { jwt }  = JSON.parse(output);

  const response = NextResponse.json({ ok: true });
  response.cookies.set('appwrite_jwt', jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  return response;
}
