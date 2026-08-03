import { PrismaPg } from '@prisma/adapter-pg';

import { PasswordService } from '../auth/password.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { UserRole } from '../generated/prisma/enums.js';

const TEST_PASSWORD = 'Fictional-only-Password-42!';

async function main(): Promise<void> {
  if (!['local', 'test'].includes(process.env.APP_ENV ?? '')) {
    throw new Error('Test identity seed is forbidden outside local/test');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const passwordHash = await new PasswordService().hash(TEST_PASSWORD);
  try {
    const identities = [
      ['listener-a@example.test', '虚构倾听员 A', UserRole.interviewer],
      ['listener-b@example.test', '虚构倾听员 B', UserRole.interviewer],
      ['admin@example.test', '虚构管理员', UserRole.admin],
      ['data-admin@example.test', '虚构数据管理员', UserRole.data_admin],
      ['disabled@example.test', '虚构停用用户', UserRole.interviewer],
    ] as const;
    for (const [email, displayName, role] of identities) {
      await prisma.user.upsert({
        create: { displayName, email, passwordHash, role },
        update: { displayName, passwordHash, role },
        where: { email },
      });
    }
    await prisma.user.update({
      data: { disabledAt: new Date(), status: 'disabled' },
      where: { email: 'disabled@example.test' },
    });
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Seed failed'}\n`);
  process.exitCode = 1;
});
