import { EventsCleanupService } from '../src/events/events-cleanup.service.js';
import { EventsRepository } from '../src/events/events.repository.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { EVENT_CLEANUP_BATCH_SIZE, EVENT_TRASH_RETENTION_MS } from '../src/events/events.constants.js';

describe('Expired event cleanup', () => {
  const findMany = vi.fn<() => Promise<{ id: string }[]>>();
  const deleteMany = vi.fn<() => Promise<{ count: number }>>();
  const prisma = { event: { findMany, deleteMany } } as unknown as PrismaService;
  const repository = new EventsRepository(prisma);
  const cleanup = new EventsCleanupService(repository);
  const now = new Date('2026-11-23T12:00:00Z');
  const cutoff = new Date(now.getTime() - EVENT_TRASH_RETENTION_MS);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    findMany.mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => { vi.useRealTimers(); });

  it('selects bounded batches eligible at or before the 21-day cutoff', async () => {
    expect(await cleanup.cleanupExpiredEvents()).toEqual({ count: 0 });
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { deletedAt: { lte: cutoff } },
      orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
      take: EVENT_CLEANUP_BATCH_SIZE, select: { id: true },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('rechecks expiry during permanent deletion to protect restored rows', async () => {
    findMany.mockResolvedValue([{ id: 'expired-row' }, { id: 'restored-after-selection' }]);
    deleteMany.mockResolvedValue({ count: 1 });
    expect(await cleanup.cleanupExpiredEvents()).toEqual({ count: 1 });
    expect(deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: { in: ['expired-row', 'restored-after-selection'] },
        deletedAt: { lte: cutoff },
      },
    });
  });

  it('handles another worker already removing the selected rows', async () => {
    findMany.mockResolvedValue([{ id: 'already-removed' }]);
    expect(await cleanup.cleanupExpiredEvents()).toEqual({ count: 0 });
  });

  it('can retry on the next run after selection fails', async () => {
    findMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(cleanup.cleanupExpiredEvents()).rejects.toThrow('database unavailable');
    expect(deleteMany).not.toHaveBeenCalled();
    expect(await cleanup.cleanupExpiredEvents()).toEqual({ count: 0 });
  });

  it('propagates deletion failures so the scheduler can log them', async () => {
    findMany.mockResolvedValue([{ id: 'expired-row' }]);
    deleteMany.mockRejectedValue(new Error('database unavailable'));
    await expect(cleanup.cleanupExpiredEvents()).rejects.toThrow('database unavailable');
  });
});
