#!/usr/bin/env node
const readline = require("readline");
const { Writable } = require("stream");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const mutableStdout = new Writable({
  write(chunk, encoding, callback) {
    callback();
  }
});

function createInterface(output) {
  return readline.createInterface({
    input: process.stdin,
    output,
    terminal: true
  });
}

function askQuestion(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function askHidden(question) {
  const hiddenRl = createInterface(mutableStdout);
  process.stdout.write(question);

  return new Promise((resolve) => {
    hiddenRl.question("", (answer) => {
      process.stdout.write("\n");
      hiddenRl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const rl = createInterface(process.stdout);

  try {
    const userId = (await askQuestion(rl, "Introdu ID-ul utilizatorului: ")).trim();

    if (!userId) {
      console.error("ID de utilizator invalid.");
      process.exitCode = 1;
      return;
    }

    let password = "";
    let confirmation = "";

    do {
      password = await askHidden("Introdu parola nouă: ");
      confirmation = await askHidden("Confirmă parola nouă: ");

      if (!password) {
        console.log("Parola nu poate fi goală. Încercați din nou.\n");
      } else if (password !== confirmation) {
        console.log("Parolele nu coincid. Încercați din nou.\n");
      }
    } while (!password || password !== confirmation);

    const hashedPassword = await bcrypt.hash(password, 12);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { hashedPassword }
    });

    console.log(`Parola a fost resetată pentru utilizatorul cu emailul ${updatedUser.email}.`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      console.error("Utilizatorul nu a fost găsit.");
    } else {
      console.error("A apărut o eroare la resetarea parolei.", error);
    }
    process.exitCode = 1;
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

process.on("SIGINT", async () => {
  console.log("\nOperațiune întreruptă.");
  await prisma.$disconnect();
  process.exit(130);
});

main();
