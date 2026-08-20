import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database/prisma.service.js';
import { MemoryP2PersistenceReader } from './memory-p2-persistence.reader.js';

describe('MemoryP2PersistenceReader', () => {
  it.each(['upgrading', 'interrupted', 'unavailable'])(
    'fails closed while the migration is %s',
    async (status) => {
      const checkpointRead = vi.fn();
      const prisma = {
        memoryEvolutionCheckpoint: { findUnique: checkpointRead },
        memoryP2MigrationManifest: { findFirst: vi.fn().mockResolvedValue({ status }) },
      } as unknown as PrismaService;
      const reader = new MemoryP2PersistenceReader(prisma);
      await expect(
        reader.readCheckpoint('11111111-1111-4111-8111-111111111111'),
      ).resolves.toBeNull();
      await expect(
        reader.readCurrentLayer('22222222-2222-4222-8222-222222222222'),
      ).resolves.toBeNull();
      expect(checkpointRead).not.toHaveBeenCalled();
    },
  );

  it('rejects a committed checkpoint whose member order is not contiguous', async () => {
    const prisma = {
      aiJob: {
        findUnique: vi.fn().mockResolvedValue({
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
          retentionState: 'active',
          status: 'succeeded',
        }),
      },
      memoryEvolutionCheckpoint: {
        findUnique: vi.fn().mockResolvedValue({
          committedAt: new Date(),
          expectedMemberCount: 1,
          id: '11111111-1111-4111-8111-111111111111',
          lifecycleStatus: 'committed',
          memberManifestHash: '0'.repeat(64),
          p2ProducerJobId: '22222222-2222-4222-8222-222222222222',
          projectId: '33333333-3333-4333-8333-333333333333',
          sourceSessionId: '44444444-4444-4444-8444-444444444444',
        }),
      },
      memoryEvolutionCheckpointMember: {
        findMany: vi.fn().mockResolvedValue([{ inputOrder: 1 }]),
      },
      memoryP2MigrationManifest: {
        findFirst: vi.fn().mockResolvedValue({ status: 'completed' }),
      },
      memoryP2RetentionTarget: { findFirst: vi.fn().mockResolvedValue({ id: 'target' }) },
    } as unknown as PrismaService;
    const reader = new MemoryP2PersistenceReader(prisma);
    await expect(reader.readCheckpoint('11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
  });
});
