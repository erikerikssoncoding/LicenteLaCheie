import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Date invalide" }, { status: 400 });
  }

  const { email, password } = body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    return NextResponse.json({ error: "Email și parola sunt obligatorii" }, { status: 400 });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Un cont cu acest email există deja" },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        email,
        hashedPassword
      }
    });

    return NextResponse.json(
      { message: "Cont creat cu succes" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Nu s-a putut crea contul", error);
    await logError("Nu s-a putut crea contul", error);

    return NextResponse.json(
      { error: "A apărut o eroare neașteptată. Încercați din nou." },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
