import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { authDebugLog, summarizeAuthConfiguration, summarizeToken } from "./lib/auth-debug";

const DASHBOARD_PATH = "/dashboard";
const ADMIN_SEGMENT = "/admin";
const CLIENT_SEGMENT = "/client";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
const authSalt = process.env.AUTH_SALT ?? process.env.NEXTAUTH_SALT;

export async function middleware(request: NextRequest) {
  authDebugLog("middleware.request.received", {
    request: {
      method: request.method,
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
    },
    authConfiguration: summarizeAuthConfiguration(),
  });

  let token;

  const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
  const forwardedProto = forwardedProtoHeader?.split(",")[0]?.trim().toLowerCase();
  const secureCookie =
    request.nextUrl.protocol === "https:" || forwardedProto === "https";

  try {
    token = await getToken({
      req: request,
      secureCookie,
      ...(authSecret ? { secret: authSecret } : {}),
      ...(authSalt ? { salt: authSalt } : {}),
    });

    authDebugLog("middleware.getToken.success", {
      token: summarizeToken(token),
      secureCookie,
    });
  } catch (error) {
    authDebugLog("middleware.getToken.error", {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });

    throw error;
  }

  if (!token) {
    authDebugLog("middleware.unauthenticated", {
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
    });

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const role = (token.role as string | undefined) ?? "CLIENT";
  const pathname = request.nextUrl.pathname;

  authDebugLog("middleware.authenticated", {
    pathname,
    role,
  });

  const isDashboardRoot = pathname === DASHBOARD_PATH || pathname === `${DASHBOARD_PATH}/`;
  if (isDashboardRoot) {
    const destination = role === "ADMIN" ? `${DASHBOARD_PATH}${ADMIN_SEGMENT}` : `${DASHBOARD_PATH}${CLIENT_SEGMENT}`;
    authDebugLog("middleware.redirect.dashboard-root", {
      destination,
    });
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (pathname.startsWith(`${DASHBOARD_PATH}${ADMIN_SEGMENT}`) && role !== "ADMIN") {
    authDebugLog("middleware.redirect.non-admin", {
      pathname,
      role,
      destination: `${DASHBOARD_PATH}${CLIENT_SEGMENT}`,
    });
    return NextResponse.redirect(new URL(`${DASHBOARD_PATH}${CLIENT_SEGMENT}`, request.url));
  }

  if (pathname.startsWith(`${DASHBOARD_PATH}${CLIENT_SEGMENT}`) && role === "ADMIN") {
    authDebugLog("middleware.redirect.admin", {
      pathname,
      role,
      destination: `${DASHBOARD_PATH}${ADMIN_SEGMENT}`,
    });
    return NextResponse.redirect(new URL(`${DASHBOARD_PATH}${ADMIN_SEGMENT}`, request.url));
  }

  authDebugLog("middleware.request.next", {
    pathname,
    role,
  });

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
