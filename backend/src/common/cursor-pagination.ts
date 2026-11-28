import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PAGE_SIZE, type CursorPaginationQueryDto } from './dto/cursor-pagination-query.dto.js';

/** The repository must apply its access filters, use a stable order, and include the cursor row. */
export async function paginateByCursor<T extends { id: string }>(
  { limit = DEFAULT_PAGE_SIZE, cursor }: CursorPaginationQueryDto,
  fetchRows: (take: number, cursor?: string) => Promise<readonly T[]>,
  invalidCursorMessage = 'Invalid cursor',
) {
  const cursorRows = cursor ? 1 : 0;
  const pageEnd = cursorRows + limit;
  // The extra row tells us whether another page exists, even when this page is full.
  const rows = await fetchRows(pageEnd + 1, cursor);
  if (cursor && rows[0]?.id.toLowerCase() !== cursor.toLowerCase()) {
    throw new BadRequestException(invalidCursorMessage);
  }

  const items = rows.slice(cursorRows, pageEnd);
  return { items, nextCursor: rows.length > pageEnd ? items[items.length - 1]!.id : null };
}
