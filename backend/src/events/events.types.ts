export type CreateEventInput = {
  ownerId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  privateNote?: string;
};
