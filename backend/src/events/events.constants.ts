export const TIMESTAMP_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const EVENT_TRASH_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
export const EVENT_CLEANUP_BATCH_SIZE = 500;
