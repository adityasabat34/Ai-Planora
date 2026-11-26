import { paginateByCursor } from '../src/common/cursor-pagination.js';

describe('paginateByCursor', () => {
  const events = [
    { id: 'da705193-7818-43b7-aaa6-c4998e886c1b', title: 'Planning' },
    { id: 'f133da07-e2bd-473a-a694-442e9e5888dd', title: 'Workshop' },
    { id: 'd248ee59-decb-47fb-ae07-7148114f8431', title: 'Standup' },
    { id: 'b7c9629a-45f2-492b-9d26-bc3b558da497', title: 'Review' },
  ];

  it('continues after the last returned UUID and recognizes a full final page', async () => {
    const fetchRows = vi.fn<(take: number, cursor?: string) => Promise<typeof events>>()
      .mockResolvedValueOnce(events.slice(0, 3))
      .mockResolvedValueOnce(events.slice(1));

    const first = await paginateByCursor({ limit: 2 }, fetchRows);
    expect(first).toEqual({ items: events.slice(0, 2), nextCursor: events[1]!.id });
    expect(fetchRows).toHaveBeenNthCalledWith(1, 3, undefined);

    const cursor = first.nextCursor!.toUpperCase();
    const second = await paginateByCursor({ limit: 2, cursor }, fetchRows);
    expect(second).toEqual({ items: events.slice(2), nextCursor: null });
    expect(fetchRows).toHaveBeenNthCalledWith(2, 4, cursor);
  });

  it('rejects a cursor excluded by the repository filter', async () => {
    const fetchRows = vi.fn().mockResolvedValue(events.slice(2));
    await expect(paginateByCursor({ limit: 2, cursor: events[1]!.id }, fetchRows))
      .rejects.toThrow('Invalid cursor');
  });
});
