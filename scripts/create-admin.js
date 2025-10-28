#!/usr/bin/env node
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash("123123test!", 12);
  const user = await prisma.user.create({
    data: {
      email: "office@designtoro.ro",
      hashedPassword,
      role: "ADMIN"
    }
  });
  console.log("Admin creat cu ID:", user.id);
}

main()
  .catch((err) => {
    console.error("Eroare la crearea adminului:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
