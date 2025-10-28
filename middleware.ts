import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const DASHBOARD_PATH = "/dashboard";
const ADMIN_SEGMENT = "/admin";
const CLIENT_SEGMENT = "/client";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
const authSalt = process.env.AUTH_SALT ?? process.env.NEXTAUTH_SALT;

export async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    ...(authSecret ? { secret: authSecret } : {}),
    ...(authSalt ? { salt: authSalt } : {}),
  });

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const role = (token.role as string | undefined) ?? "CLIENT";
  const pathname = request.nextUrl.pathname;

  const isDashboardRoot = pathname === DASHBOARD_PATH || pathname === `${DASHBOARD_PATH}/`;
  if (isDashboardRoot) {
    const destination = role === "ADMIN" ? `${DASHBOARD_PATH}${ADMIN_SEGMENT}` : `${DASHBOARD_PATH}${CLIENT_SEGMENT}`;
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (pathname.startsWith(`${DASHBOARD_PATH}${ADMIN_SEGMENT}`) && role !== "ADMIN") {
    return NextResponse.redirect(new URL(`${DASHBOARD_PATH}${CLIENT_SEGMENT}`, request.url));
  }

  if (pathname.startsWith(`${DASHBOARD_PATH}${CLIENT_SEGMENT}`) && role === "ADMIN") {
    return NextResponse.redirect(new URL(`${DASHBOARD_PATH}${ADMIN_SEGMENT}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
