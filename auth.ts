import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    };
  }

  interface User {
    id: string;
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    sub?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const role = (user as { role?: string }).role ?? "CLIENT";
        token.id = user.id;
        token.role = role;
        token.sub = user.id;
      }

      const allowedKeys = new Set(["id", "role", "sub", "exp", "iat", "jti"]);
      Object.keys(token).forEach((key) => {
        if (!allowedKeys.has(key)) {
          delete (token as Record<string, unknown>)[key];
        }
      });

      return token;
    },
    async session({ session, token }) {
      return {
        user: {
          id: (token.id as string) ?? (token.sub as string) ?? "",
          role: (token.role as string) ?? "CLIENT"
        },
        expires: session.expires
      };
    }
  }
});
