#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  try {
    const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Variabila ${key} nu este setata in .env`);
      }
    }

    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      multipleStatements: true
    });

    const migrationsDir = path.resolve(__dirname, '../migrations');
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (\n        id INT AUTO_INCREMENT PRIMARY KEY,\n        migration VARCHAR(255) NOT NULL UNIQUE,\n        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n      )`
    );

    const [appliedRows] = await connection.query('SELECT migration FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.migration));

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Aplic migratia ${file}...`);
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (migration) VALUES (?)', [file]);
      appliedCount += 1;
    }

    if (appliedCount === 0) {
      console.log('Nu exista migratii noi de aplicat.');
    } else {
      console.log(`Au fost aplicate ${appliedCount} migratii.`);
    }

    await connection.end();
  } catch (error) {
    console.error('Eroare la actualizarea bazei de date:', error);
    process.exitCode = 1;
  }
}

run();
