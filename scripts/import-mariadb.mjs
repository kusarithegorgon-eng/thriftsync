import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const sqlFile = fileURLToPath(new URL('../database/thrifysync.sql', import.meta.url));
const database = process.env.MYSQL_DATABASE || 'thrifysync';
const xamppMysql = 'C:\\xampp\\mysql\\bin\\mysql.exe';
const mysqlArgs = [
  '--host',
  process.env.MYSQL_HOST || '127.0.0.1',
  '--port',
  process.env.MYSQL_PORT || '3306',
  '--user',
  process.env.MYSQL_USER || 'root',
  '--database',
  database,
  '--default-character-set=utf8mb4',
];

async function findMysqlExecutable() {
  if (process.env.MYSQL_CLI) {
    return process.env.MYSQL_CLI;
  }

  try {
    await access(xamppMysql);
    return xamppMysql;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return 'mysql';
}

if (process.env.MYSQL_PASSWORD) {
  process.env.MYSQL_PWD = process.env.MYSQL_PASSWORD;
  delete process.env.MYSQL_PASSWORD;
}

const mysqlExecutable = await findMysqlExecutable();

function runMysql(args, sqlInput = '') {
  return new Promise((resolve, reject) => {
    const mysql = spawn(mysqlExecutable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    mysql.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    mysql.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    mysql.on('error', (error) => {
      reject(new Error(`Could not start the MySQL client. Install MySQL/MariaDB or add mysql to PATH. ${error.message}`));
    });
    mysql.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `MySQL exited with code ${code}.`));
      }
    });

    mysql.stdin.end(sqlInput);
  });
}

try {
  const existingTableCount = Number(
    await runMysql([
      ...mysqlArgs,
      '--batch',
      '--skip-column-names',
      '--execute',
      'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()',
    ]),
  );

  if (existingTableCount > 0) {
    throw new Error(
      `Database "${database}" already contains ${existingTableCount} table(s). This dump is intended for an empty database; no SQL was imported.`,
    );
  }

  const sql = await readFile(sqlFile, 'utf8');
  await runMysql(mysqlArgs, sql);
  console.log(`Imported ${sqlFile} into database "${database}".`);
} catch (error) {
  console.error(`Database import failed: ${error.message}`);
  process.exitCode = 1;
}
