import { z } from 'zod';

export const BookingItemSchema = z.object({ programTypeId: z.string().min(1) });

export const CreateBookingSchema = z.object({
  title: z.string().min(2),
  start: z.string().datetime(),
  end: z.string().datetime().optional(),
  locationType: z.enum(['GURDWARA', 'OUTSIDE_GURDWARA']),
  hallId: z.string().optional().nullable(),
  attendees: z.number().int().min(1).max(10000).optional(),
  address: z.string().optional().nullable(),
  contactName: z.string().min(2),
  contactPhone: z.string().min(7),
  notes: z.string().optional().nullable(),
  items: z.array(BookingItemSchema).min(1),
});

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
