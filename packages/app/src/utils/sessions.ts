import z from 'zod';

export const sessionRowSchema = z.object({
  body: z.string().nullish(),
  component: z.string().nullish(),
  durationInMs: z.number(),
  'error.message': z.string().nullish(),
  'http.method': z.string().nullish(),
  'http.status_code': z.string().nullish(),
  'http.url': z.string().nullish(),
  id: z.string(),
  'location.href': z.string().nullish(),
  'otel.library.name': z.string(),
  parent_span_id: z.string(),
  severity_text: z.string(),
  span_id: z.string(),
  span_name: z.string(),
  timestamp: z.string(),
  trace_id: z.string(),
  type: z.string().nullish(),
});

export type SessionRow = z.infer<typeof sessionRowSchema>;
