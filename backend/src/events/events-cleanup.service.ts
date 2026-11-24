import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventsRepository } from './events.repository.js';
import { EVENT_TRASH_RETENTION_MS } from './events.constants.js';

@Injectable()
export class EventsCleanupService {
  private readonly logger = new Logger(EventsCleanupService.name);

  constructor(private readonly eventsRepository: EventsRepository) { }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'expired-event-cleanup', waitForCompletion: true })
  async cleanupExpiredEvents() {
    const cutoff = new Date(Date.now() - EVENT_TRASH_RETENTION_MS);
    const result = await this.eventsRepository.deleteExpiredBatch(cutoff);
    if (result.count > 0) this.logger.log(`Permanently removed ${result.count} expired events`);
    return result;
  }
}
