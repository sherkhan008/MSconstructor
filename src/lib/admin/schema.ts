import { z } from 'zod';
import { ORDER_STATUS_VALUES } from '@/lib/orders/status-labels';

export const adminLoginSchema = z.object({
  email: z.string().trim().min(1).max(200).email(),
  password: z.string().min(1).max(200),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
