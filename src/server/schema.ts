import { z } from 'zod';

const state = z.boolean().nullable().optional();

/**
 * Corps accepté par POST /api/measurements.
 * Chaque champ est un booléen, `null` ou absent. Tout autre type (0, "1", ...) est refusé :
 * on ne « corrige » jamais une valeur douteuse. Les clés inconnues sont refusées aussi.
 */
export const measurementInputSchema = z
  .object({
    measuredAt: z.string().datetime({ offset: true }).optional(),
    sourceA: state,
    sourceB: state,
    load1: state,
    load2: state,
  })
  .strict();

export type MeasurementInput = z.infer<typeof measurementInputSchema>;

export const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});
