import { z } from 'zod';

/** Largest value a PostgreSQL `integer` (int4) column accepts. */
export const INT4_MAX = 2_147_483_647;

/** A non-negative whole number typed as text, bounded so the database cast cannot overflow. */
export function wholeNumberText(max: number, messages: { format: string; range: string }, min = 0) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, messages.format)
    .refine((value) => {
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= min && number <= max;
    }, messages.range);
}
