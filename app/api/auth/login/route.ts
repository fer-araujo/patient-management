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
        'Content-Type':           'application/json',
        'X-Appwrite-Project':     projectId,
        'X-Appwrite-Response-Format': '1.0.0',
      },
      body: JSON.stringify({ passKey }),
    }
  );

  const execJson = await execRes.json();
  return NextResponse.json(execJson);
}
