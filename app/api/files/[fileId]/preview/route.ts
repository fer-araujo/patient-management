import { NextResponse }          from "next/server";
import { cookies }               from "next/headers";
import { getStorage }            from "@/lib/appwrite.config";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  // 1) Esperar a que cookies() resuelva
  const cookieStore = await cookies();
  const jwt = cookieStore.get(`a_session_${process.env.NEXT_PUBLIC_PROJECT_ID}`)?.value;

  if (!jwt) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  try {
    // 2) Instanciar Storage con el JWT
    const storage = getStorage(jwt);
    const file = await storage.getFileDownload(
      process.env.NEXT_PUBLIC_BUCKET_ID!,
      fileId
    );

    return new NextResponse(file, {
      headers: {
        "Content-Type":        "image/jpeg",
        "Content-Disposition": `inline; filename="${fileId}.jpg"`,
      },
    });
  } catch (err) {
    console.error("Error en file preview:", err);
    return new NextResponse("Error al obtener el archivo", { status: 500 });
  }
}
