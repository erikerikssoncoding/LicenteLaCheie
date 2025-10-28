import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";

import { authConfig } from "./auth.config";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      role?: string;
    };
  }

  interface User {
    id?: string;
    role?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      const mutableToken = token as JWT & { id?: string; role?: string };

      if (user) {
        const role = (user as { role?: string }).role ?? "CLIENT";
        mutableToken.id = user.id;
        mutableToken.role = role;
        mutableToken.sub = user.id;
      }

      const allowedKeys = new Set(["id", "role", "sub", "exp", "iat", "jti"]);
      Object.keys(mutableToken).forEach((key) => {
        if (!allowedKeys.has(key)) {
          delete (mutableToken as Record<string, unknown>)[key];
        }
      });

      return mutableToken;
    },
    async session({ session, token }) {
      const typedToken = token as JWT & { id?: string; role?: string };
      return {
        user: {
          id: typedToken.id ?? typedToken.sub ?? "",
          role: typedToken.role ?? "CLIENT"
        },
        expires: session.expires
      };
    }
  }
});
