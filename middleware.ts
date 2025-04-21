// File: middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const name = `a_session_${process.env.NEXT_PUBLIC_PROJECT_ID}`;
  const sessionCookie = req.cookies.get(name)?.value;

  if (!sessionCookie) {
    const loginUrl = new URL("/", req.url);
    loginUrl.searchParams.set("redirect", "admin");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = { matcher: "/admin/:path*" };
