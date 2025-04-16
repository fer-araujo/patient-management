import { NextResponse } from "next/server";
import { getStorage } from "@/lib/appwrite.config";

export async function GET(
  req: Request,
  { params }: { params: { fileId: string } }
) {
  try {
    const fileId = params.fileId;
    const storage = getStorage();

    const file = await storage.getFileDownload(
      process.env.NEXT_PUBLIC_BUCKET_ID!,
      fileId
    );

    // Convierte el buffer de Appwrite a una respuesta binaria
    return new NextResponse(file, {
      headers: {
        "Content-Type": "image/jpeg", // o usa image/png si aplica
        "Content-Disposition": `inline; filename="${fileId}.jpg"`,
      },
    });
  } catch (err) {
    console.error("Error en file preview:", err);
    return new NextResponse("No autorizado", { status: 401 });
  }
}
