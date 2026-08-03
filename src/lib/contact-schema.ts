import { z } from 'zod';
import { phoneSchema } from '@/lib/pricing/schema';

export const contactRequestSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: phoneSchema,
  message: z.string().trim().min(1).max(2000),
});

export type ContactRequestInput = z.infer<typeof contactRequestSchema>;
