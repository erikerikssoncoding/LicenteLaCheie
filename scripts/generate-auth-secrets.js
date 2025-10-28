#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function askQuestion(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function generateSecret() {
  return crypto.randomBytes(32).toString("base64");
}

function upsertEnvValues(filePath, values) {
  const envPath = path.resolve(process.cwd(), filePath);
  let content = "";

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  }

  const lines = content
    .split(/\r?\n/)
    .filter((line) => line && !values.some(([key]) => line.startsWith(`${key}=`)));

  const newLines = [...lines, ...values.map(([key, value]) => `${key}=${value}`)].join("\n");

  fs.writeFileSync(envPath, `${newLines}\n`);
}

async function main() {
  const authSecret = generateSecret();
  const authSalt = generateSecret();

  console.log("\nValori generate:");
  console.log(`AUTH_SECRET=${authSecret}`);
  console.log(`AUTH_SALT=${authSalt}`);

  const rl = createInterface();

  const saveAnswer = await askQuestion(
    rl,
    "\nDoriți să salvați aceste valori într-un fișier .env? (da/nu): "
  );

  if (saveAnswer.toLowerCase() === "da" || saveAnswer.toLowerCase() === "d") {
    const defaultPath = ".env.local";
    let targetPath = await askQuestion(
      rl,
      `Introduceți calea fișierului .env (implicit ${defaultPath}): `
    );

    if (!targetPath) {
      targetPath = defaultPath;
    }

    try {
      upsertEnvValues(targetPath, [
        ["AUTH_SECRET", authSecret],
        ["AUTH_SALT", authSalt]
      ]);
      console.log(`\nValorile au fost salvate în ${path.resolve(process.cwd(), targetPath)}.`);
    } catch (error) {
      console.error("\nA apărut o eroare la salvarea fișierului:", error);
      process.exitCode = 1;
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error("A apărut o eroare neașteptată:", error);
  process.exitCode = 1;
});
