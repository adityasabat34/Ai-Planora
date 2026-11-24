export type CreateEventInput = {
  ownerId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  privateNote?: string;
};

export type UpdateEventInput = {
  title?: string;
  startTime?: Date;
  endTime?: Date;
  location?: string | null;
  privateNote?: string | null;
};

export type EventSchedule = { startTime: Date; endTime: Date };
