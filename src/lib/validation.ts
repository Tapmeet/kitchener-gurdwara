// lib/validation.ts
import { z } from 'zod';

const MAX_ATTENDEES = Number(process.env.MAX_ATTENDEES ?? 300);

export const BookingItemSchema = z.object({
  programTypeId: z.string().min(1, 'Program is required'),
});

export const CreateBookingSchema = z.object({
  title: z.string().min(2, 'Title is required'),
  start: z.string().datetime('Start must be an ISO date-time'),
  end: z.string().datetime().optional(),
  locationType: z.enum(['GURDWARA', 'OUTSIDE_GURDWARA']),
  hallId: z.string().optional().nullable(),
  attendees: z.number().int().min(1).max(MAX_ATTENDEES),
  address: z.string().optional().nullable(),

  contactName: z.string().min(2, 'Contact name is required'),
  contactPhone: z.string().min(7, 'Contact phone is required'),
  contactEmail: z
    .string()
    .email('Please enter a valid email')
    .optional()
    .nullable(),

  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(BookingItemSchema).min(1, 'Select at least one program'),
});

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
