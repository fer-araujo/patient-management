// File: lib/actions/auth.actions.ts
import { OAuthProvider } from "appwrite";
import { webAccount } from "../appwrite.config";

/**
 * Inicia sesión con Google usando Appwrite OAuth2
 * Redirige automáticamente al admin en caso de éxito o de fallo
 */
export function signInWithGoogle(): void {
  webAccount.createOAuth2Session(
    OAuthProvider.Google,
    `${window.location.origin}/admin`, // URL de éxito
    `${window.location.origin}/?error=oauth` // URL de fallo
  );
}

/**
 * Inicia sesión con email y contraseña usando Appwrite Web SDK
 * Lanza error si las credenciales son inválidas
 */
const COOKIE_NAME = `a_session_${process.env.NEXT_PUBLIC_PROJECT_ID}`;

export async function signInWithEmail(email: string, password: string) {
  // 1) Login crea la sesión en Appwrite (cookie en appwrite.io)
  await webAccount.createEmailPasswordSession(email, password);

  // 2) Pide un JWT válido por 15 min
  const { jwt } = await webAccount.createJWT();

  // 3) Planta la cookie en TU dominio
  //    -- no es httpOnly pero sí la ve tu middleware
  document.cookie = [
    `${COOKIE_NAME}=${jwt}`,
    `Path=/`,
    `Max-Age=${15 * 60}`, // 15 minutos
    `SameSite=Lax`,
    // `Secure` en prod sobre HTTPS
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function getLiveSession() {
  try {
    await webAccount.get();
    // Si existe, genera un nuevo JWT desde el cliente y planta la cookie en este dominio
    const { jwt } = await webAccount.createJWT();
    // Planta la cookie JWT en tu dominio
    document.cookie = [
      `appwrite_jwt=${jwt}`,
      `Path=/`,            // accesible en todo el dominio
      `Max-Age=${15 * 60}`, // 15 minutos
      `SameSite=Lax`,
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
    return true;
  } catch {
    return false;
  }
}
