import { NextRequest, NextResponse } from "next/server";
import * as SibApiV3Sdk from "@sendinblue/client";

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Date invalide" }, { status: 400 });
  }

  const { name, email, message } = body as {
    name?: string;
    email?: string;
    message?: string;
  };

  if (!name || !email || !message) {
    return NextResponse.json({ error: "Toate câmpurile sunt obligatorii" }, { status: 400 });
  }

  await prisma.contactMessage.create({
    data: { name, email, message }
  });

  try {
    const apiInstance = new SibApiV3Sdk.ContactsApi();
    apiInstance.setApiKey(
      SibApiV3Sdk.ContactsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY ?? ""
    );

    if (process.env.BREVO_API_KEY) {
      await apiInstance.createContact({
        email,
        attributes: {
          FIRSTNAME: name
        },
        listIds: process.env.BREVO_LIST_ID
          ? [Number(process.env.BREVO_LIST_ID)]
          : undefined,
        updateEnabled: true
      });
    }
  } catch (error) {
    console.error("Brevo contact sync failed", error);
    await logError("Brevo contact sync failed", error);
  }

  return NextResponse.json({ message: "Success" }, { status: 200 });
}
