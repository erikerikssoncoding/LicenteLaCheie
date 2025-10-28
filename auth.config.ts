import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Parola", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({
          where: { email }
        });

        if (!user) {
          return null;
        }

        const { hashedPassword, ...userWithoutPassword } = user;

        if (!hashedPassword) {
          return null;
        }

        let isValid = false;

        try {
          isValid = await bcrypt.compare(password, hashedPassword);
        } catch (error) {
          console.error("Failed to compare passwords", error);
          return null;
        }

        if (!isValid) {
          return null;
        }

        return userWithoutPassword;
      }
    })
  ]
};
