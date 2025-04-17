import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { passKey } = await request.json();

  const endpoint = process.env.NEXT_PUBLIC_ENDPOINT!;
  const projectId = process.env.NEXT_PUBLIC_PROJECT_ID!;
  const functionId = process.env.NEXT_PUBLIC_FUNCTION_ID!;

  console.log(JSON.stringify({ passKey }),`${endpoint}/functions/${functionId}/executions?sync=true`,)
  const execRes = await fetch(
    `${endpoint}/functions/${functionId}/executions?sync=true`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', // Aquí aseguramos que el cuerpo sea text/plain
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Response-Format': '1.0.0'
      },
      body: JSON.stringify({ passKey }) // El cuerpo sigue siendo un string JSON
    }
  );

  const execJson = await execRes.json();
  return NextResponse.json(execJson);
  // const output = execJson.responseBody ?? execJson.response;

  // if (!output) {
  //   console.error('❌ output vacío desde Function', execJson);
  //   return new NextResponse('Error interno al generar token', { status: 500 });
  // }

  // const parsedOutput = JSON.parse(output);

  // if (parsedOutput.error) {
  //   return new NextResponse(parsedOutput.error, { status: parsedOutput.code });
  // }

  // const { jwt } = parsedOutput;

  // const response = NextResponse.json({ ok: true });
  // response.cookies.set('appwrite_jwt', jwt, {
  //   httpOnly: true,
  //   secure: process.env.NODE_ENV === 'production',
  //   path: '/',
  // });

  // return response;
}
