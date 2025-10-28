#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({ input, output });

async function ask(question, fallback, hidden = false) {
  if (hidden) {
    output.write(question);
    return await new Promise((resolve) => {
      const chunks = [];
      const onData = (char) => {
        char = char + '';
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            output.write('\n');
            input.removeListener('data', onData);
            resolve(chunks.join(''));
            break;
          case '\u0003':
            process.exit();
            break;
          default:
            output.write('*');
            chunks.push(char);
            break;
        }
      };
      input.on('data', onData);
    });
  }
  const answer = await rl.question(`${question}${fallback ? ` (${fallback})` : ''}: `);
  return answer.trim() || fallback;
}

async function ensureEnv(config) {
  const envPath = path.resolve(__dirname, '../.env');
  const content = `# configuratie generata automat\nNODE_ENV=production\nPORT=${config.port}\nENFORCE_HTTPS=true\nSESSION_SECRET=${config.sessionSecret}\nDB_HOST=${config.dbHost}\nDB_PORT=${config.dbPort}\nDB_USER=${config.dbUser}\nDB_PASSWORD=${config.dbPassword}\nDB_NAME=${config.dbName}\n`;
  fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
  console.log(`Fisierul .env a fost creat la ${envPath}`);
}

async function runMigrations(connection, migrationsDir) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (\n      id INT AUTO_INCREMENT PRIMARY KEY,\n      migration VARCHAR(255) NOT NULL UNIQUE,\n      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    )`
  );

  const [appliedRows] = await connection.query('SELECT migration FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.migration));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Rulez migratia ${file}...`);
    await connection.query(sql);
    await connection.query('INSERT INTO schema_migrations (migration) VALUES (?)', [file]);
  }
}

async function createSuperAdmin(connection, adminConfig) {
  if (!adminConfig.email) {
    console.log('Ati ales sa nu creati acum un superadmin. Puteti folosi ulterior scriptul de administrare.');
    return;
  }
  const passwordHash = await bcrypt.hash(adminConfig.password, 12);
  await connection.query(
    `INSERT INTO users (full_name, email, password_hash, phone, role)
     VALUES (?, ?, ?, ?, 'superadmin')
     ON DUPLICATE KEY UPDATE role = VALUES(role), full_name = VALUES(full_name)` ,
    [adminConfig.fullName, adminConfig.email.toLowerCase(), passwordHash, adminConfig.phone]
  );
  console.log(`Superadmin-ul ${adminConfig.email} a fost creat sau actualizat.`);
}

async function main() {
  let closed = false;
  try {
    console.log('Instalare platforma Licente la Cheie');
    const dbHost = await ask('Host baza de date', '127.0.0.1');
    const dbPort = Number(await ask('Port baza de date', '3306'));
    const dbUser = await ask('Utilizator baza de date', 'root');
    const dbPassword = await ask('Parola utilizator', '', true);
    output.write('\n');
    const dbName = await ask('Numele bazei de date', 'licentelacheie');
    const port = Number(await ask('Port aplicatie', '3000'));
    const sessionSecret = await ask('Cheie secreta sesiuni', Math.random().toString(36).slice(2));

    const connection = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      multipleStatements: true
    });

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database: dbName });

    await ensureEnv({ dbHost, dbPort, dbUser, dbPassword, dbName, port, sessionSecret });
    await runMigrations(connection, path.resolve(__dirname, '../migrations'));

    const createAdmin = (await ask('Doriti sa creati un superadmin acum? (da/nu)', 'da')).toLowerCase();
    if (createAdmin.startsWith('d')) {
      const fullName = await ask('Nume complet superadmin', 'Administrator Principal');
      const email = await ask('Email superadmin', 'admin@licentelacheie.ro');
      const phone = await ask('Telefon superadmin', '+40 700 000 000');
      const password = await ask('Parola superadmin', '', true);
      output.write('\n');
      await createSuperAdmin(connection, { fullName, email, phone, password });
    }

    await connection.end();
    await rl.close();
    closed = true;
    console.log('Instalare finalizata cu succes.');
  } catch (error) {
    console.error('A aparut o eroare la instalare:', error);
    process.exitCode = 1;
  } finally {
    if (!closed) {
      rl.close();
    }
  }
}

main();
