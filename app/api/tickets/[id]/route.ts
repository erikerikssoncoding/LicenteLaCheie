import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TicketPriority, TicketStatus } from "@prisma/client";

interface RouteParams {
  params: {
    id: string;
  };
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Acces interzis" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Date invalide" }, { status: 400 });
  }

  const { status, priority } = body as {
    status?: string;
    priority?: string;
  };

  const statusValue = status && (Object.values(TicketStatus) as string[]).includes(status)
    ? (status as TicketStatus)
    : undefined;
  const priorityValue =
    priority && (Object.values(TicketPriority) as string[]).includes(priority)
      ? (priority as TicketPriority)
      : undefined;

  const updatedTicket = await prisma.ticket.update({
    where: { id: params.id },
    data: {
      status: statusValue,
      priority: priorityValue
    }
  });

  return NextResponse.json(updatedTicket, { status: 200 });
}
