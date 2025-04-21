// File: app/api/auth/jwt/route.ts
import { NextResponse } from 'next/server';

// Tu endpoint Appwrite y Project ID
const ENDPOINT   = process.env.NEXT_PUBLIC_ENDPOINT!;     // p.ej. https://<REGIÓN>.appwrite.io/v1
const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID!;

export async function GET(request: Request) {
  // 1) Extraer toda la cabecera Cookie (incluye a_session_<PROJECT_ID>)
  const cookieHeader = request.headers.get('cookie') ?? '';
  if (!cookieHeader.includes(`a_session_${PROJECT_ID}=`)) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // 2) Llamar al REST de Appwrite para generar un JWT basado en la sesión
  const jwtResponse = await fetch(
    `${ENDPOINT}/account/jwt`,
    {
      method: 'POST',
      headers: {
        'X-Appwrite-Project': PROJECT_ID,
        'Cookie': cookieHeader,        // reenvía la cookie completa
      },
    }
  );

  if (!jwtResponse.ok) {
    const errText = await jwtResponse.text();
    return NextResponse.json(
      { error: `Error al generar JWT: ${errText}` },
      { status: jwtResponse.status }
    );
  }

  // 3) Devolver el JWT
  const { jwt } = await jwtResponse.json();
  return NextResponse.json({ jwt });
}
