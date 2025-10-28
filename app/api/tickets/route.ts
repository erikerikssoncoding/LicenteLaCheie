import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Date invalide" }, { status: 400 });
  }

  const { title, content, priority } = body as {
    title?: string;
    content?: string;
    priority?: string;
  };

  if (!title || !content) {
    return NextResponse.json(
      { error: "Titlu și conținut sunt necesare" },
      { status: 400 }
    );
  }

  const newTicket = await prisma.ticket.create({
    data: {
      title,
      content,
      priority: priority ?? undefined,
      authorId: session.user.id
    }
  });

  return NextResponse.json(newTicket, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }

  const isAdmin = session.user.role === "ADMIN";

  const tickets = await prisma.ticket.findMany({
    where: isAdmin ? undefined : { authorId: session.user.id },
    include: {
      author: {
        select: {
          id: true,
          email: true,
          role: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json(tickets, { status: 200 });
}
