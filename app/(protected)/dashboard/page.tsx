import { redirect } from "next/navigation";

import { auth } from "@/auth";

export default async function DashboardIndexPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role === "ADMIN") {
    redirect("/dashboard/admin");
  }

  redirect("/dashboard/client");
}
