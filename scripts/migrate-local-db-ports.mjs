import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ENV_FILE = resolve(process.cwd(), '.env.local');
const TARGETS = {
  DATABASE_URL: { database: 'elder_interview_local', legacyPort: '5432', port: '15432' },
  TEST_DATABASE_URL: { database: 'elder_interview_test', legacyPort: '5433', port: '15433' },
};

function migrationError(key, message) {
  return new Error(`${key}: ${message}`);
}

function parseAssignment(line) {
  const match = line.match(
    /^(\uFEFF?\s*(?:export\s+)?)(DATABASE_URL|TEST_DATABASE_URL)(\s*=\s*)(.*)$/u,
  );
  if (!match) return null;

  const rawValue = match[4];
  const leadingLength = rawValue.length - rawValue.trimStart().length;
  const trailingLength = rawValue.length - rawValue.trimEnd().length;
  const trimmed = rawValue.trim();
  const quoted = trimmed.startsWith('"') || trimmed.startsWith("'");
  if (quoted && (trimmed.length < 2 || trimmed.at(-1) !== trimmed[0])) {
    throw migrationError(match[2], 'cannot safely parse the local database URL; no changes made');
  }

  const valueStart = leadingLength + (quoted ? 1 : 0);
  const valueEnd = rawValue.length - trailingLength - (quoted ? 1 : 0);
  return {
    key: match[2],
    value: rawValue.slice(valueStart, valueEnd),
  };
}

function validateUrl(key, value) {
  const target = TARGETS[key];
  let url;
  try {
    url = new URL(value);
  } catch {
    throw migrationError(key, 'is not a recognized local PostgreSQL URL; no changes made');
  }

  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== `/${target.database}` ||
    ![target.legacyPort, target.port].includes(url.port)
  ) {
    throw migrationError(key, 'is not a recognized local PostgreSQL URL; no changes made');
  }

  return target;
}

function replacePort(value, target) {
  const authority = new RegExp(
    `^(postgresql://(?:[^/?#]*@)?127\\.0\\.0\\.1:)${target.legacyPort}(?=[/?#]|$)`,
    'iu',
  );
  return value.replace(authority, `$1${target.port}`);
}

export async function migrateLocalDbPorts(filePath = DEFAULT_ENV_FILE) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        '.env.local: file not found; create it before running the local DB port migration',
        { cause: error },
      );
    }
    throw new Error('.env.local: cannot be read; no changes made', { cause: error });
  }

  const seen = new Set();
  const lines = contents.split(/(\r\n|\n|\r)/u);
  const changedKeys = [];
  for (let index = 0; index < lines.length; index += 2) {
    const assignment = parseAssignment(lines[index]);
    if (!assignment) continue;
    if (seen.has(assignment.key)) {
      throw migrationError(assignment.key, 'appears more than once; no changes made');
    }
    seen.add(assignment.key);
    const target = validateUrl(assignment.key, assignment.value);
    const migratedValue = replacePort(assignment.value, target);
    if (migratedValue !== assignment.value) {
      lines[index] = lines[index].replace(assignment.value, migratedValue);
      changedKeys.push(assignment.key);
    }
  }

  if (seen.size === 0) {
    throw new Error(
      'DATABASE_URL/TEST_DATABASE_URL: no local database URLs found; no changes made',
    );
  }
  if (changedKeys.length > 0) await writeFile(filePath, lines.join(''), 'utf8');
  return { changedKeys };
}

async function main() {
  try {
    const { changedKeys } = await migrateLocalDbPorts();
    if (changedKeys.length === 0) {
      console.log(
        'No changes needed; DATABASE_URL and TEST_DATABASE_URL already use local repository ports.',
      );
    } else {
      console.log(`Migrated local DB ports for ${changedKeys.join(' and ')}.`);
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : '.env.local: migration failed; no changes made',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
