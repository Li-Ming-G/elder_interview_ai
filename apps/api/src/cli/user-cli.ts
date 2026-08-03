import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';

import { PasswordService } from '../auth/password.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { AuditActorType, UserRole, UserStatus } from '../generated/prisma/enums.js';
import { normalizeEmail, validatePassword } from '../auth/auth.utils.js';

type Command = 'user:create' | 'user:set-password' | 'user:disable' | 'user:enable';

function flag(args: readonly string[], name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (value === undefined || value.startsWith('--'))) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

function requiredFlag(args: readonly string[], name: string): string {
  const value = flag(args, name);
  if (value === undefined) throw new Error(`Missing required option ${name}`);
  return value;
}

export async function readHiddenPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error('Password input requires an interactive terminal');
  stdout.write(prompt);
  const muted = new Writable({
    write(_chunk, _encoding, callback): void {
      callback();
    },
  });
  const terminal = createInterface({ input: stdin, output: muted, terminal: true });
  try {
    const value = await terminal.question('');
    stdout.write('\n');
    return value;
  } finally {
    terminal.close();
  }
}

export async function readConfirmedPassword(
  reader: (prompt: string) => Promise<string> = readHiddenPassword,
): Promise<string> {
  const first = validatePassword(await reader('Password: '));
  const second = await reader('Confirm password: ');
  if (first !== second) throw new Error('Password confirmation does not match');
  return first;
}

export async function executeUserCommand(
  prisma: PrismaClient,
  args: readonly string[],
  passwordReader: (prompt: string) => Promise<string> = readHiddenPassword,
): Promise<string> {
  const command = args[0] as Command | undefined;
  if (
    !['user:create', 'user:set-password', 'user:disable', 'user:enable'].includes(command ?? '')
  ) {
    throw new Error('Expected user:create, user:set-password, user:disable, or user:enable');
  }
  if (args.some((value) => value === '--password' || value.startsWith('--password='))) {
    throw new Error('Passwords are never accepted as command arguments');
  }
  const operatorReference = requiredFlag(args, '--operator-ref');
  const email = normalizeEmail(flag(args, '--email'));
  const passwords = new PasswordService();
  if (command === 'user:create') {
    const displayName = requiredFlag(args, '--display-name');
    const role = flag(args, '--role') as UserRole;
    if (!Object.values(UserRole).includes(role)) throw new Error('Invalid --role');
    const passwordHash = await passwords.hash(await readConfirmedPassword(passwordReader));
    return prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: { displayName, email, passwordHash, role },
      });
      await writeAudit(transaction, operatorReference, 'user.create', user.id);
      return user.id;
    });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  if (command === 'user:set-password') {
    const passwordHash = await passwords.hash(await readConfirmedPassword(passwordReader));
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({ data: { passwordHash }, where: { id: user.id } });
      await transaction.authSession.updateMany({
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
        where: { revokedAt: null, userId: user.id },
      });
      await writeAudit(transaction, operatorReference, 'user.set_password', user.id);
    });
  } else if (command === 'user:disable') {
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        data: { disabledAt: now, status: UserStatus.disabled },
        where: { id: user.id },
      });
      await transaction.authSession.updateMany({
        data: { revokedAt: now, revokedReason: 'user_disabled' },
        where: { revokedAt: null, userId: user.id },
      });
      await writeAudit(transaction, operatorReference, 'user.disable', user.id);
    });
  } else {
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        data: { disabledAt: null, status: UserStatus.active },
        where: { id: user.id },
      });
      await writeAudit(transaction, operatorReference, 'user.enable', user.id);
    });
  }
  return user.id;
}

async function writeAudit(
  prisma: Pick<PrismaClient, 'auditLog'>,
  actorReference: string,
  action: string,
  entityId: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action,
      actorReference,
      actorType: AuditActorType.system_operator,
      entityId,
      entityType: 'user',
      metadata: {},
    },
  });
}

if (process.argv[1]?.endsWith('user-cli.js')) {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  void executeUserCommand(prisma, process.argv.slice(2))
    .then((userId) => {
      stdout.write(`Updated user ${userId}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'User operation failed'}\n`);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
