import NextAuth from "next-auth";
import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";

import { authConfig } from "./auth.config";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: string;
    };
  }

  interface User {
    id?: string | number;
    role?: string | null;
  }
}

type AuthenticatedToken = JWT & {
  userId?: string;
  role?: string;
};

function normalizeUserId(id: unknown): string | undefined {
  if (typeof id === "string") {
    return id;
  }

  if (typeof id === "number") {
    return id.toString();
  }

  return undefined;
}

function resolveUserRole(user: { role?: string | null } | null | undefined): string {
  const rawRole = user?.role;
  return typeof rawRole === "string" && rawRole.trim().length > 0 ? rawRole : "CLIENT";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const nextToken: AuthenticatedToken = { ...token } as AuthenticatedToken;

      if (user) {
        const userId = normalizeUserId(user.id);
        if (userId) {
          nextToken.userId = userId;
          nextToken.sub = userId;
        }
        nextToken.role = resolveUserRole(user);
        if (user.email) {
          nextToken.email = user.email;
        }
        if (user.name) {
          nextToken.name = user.name;
        }
      }

      if (trigger === "update" && session?.user) {
        const sessionRole = resolveUserRole(session.user as { role?: string | null });
        nextToken.role = sessionRole;
      }

      return nextToken;
    },
    async session({ session, token }) {
      const { user: sessionUser, expires } = session;
      const typedToken = token as AuthenticatedToken;
      const userId = typedToken.userId ?? typedToken.sub ?? "";
      const role = typedToken.role ?? "CLIENT";

      return {
        ...session,
        user: {
          ...sessionUser,
          id: userId,
          role,
          email: sessionUser?.email ?? (token.email as string | undefined) ?? undefined,
          name: sessionUser?.name ?? (token.name as string | undefined) ?? undefined
        },
        expires
      };
    },
    async authorized({ auth }) {
      return Boolean(auth?.user);
    }
  }
});
