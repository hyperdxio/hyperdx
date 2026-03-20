import type express from 'express';

/** Any object whose toJSON() returns a string (e.g. Date, ObjectId). */
type JsonStringifiable = { toJSON(): string };

/**
 * Inverse of Serialized<T>: wherever the response type expects a string,
 * also accept anything that JSON.stringify converts to a string (i.e. has
 * toJSON(): string). This allows passing raw Mongoose data to sendJson()
 * while keeping type inference from the typed Express response.
 */
type PreSerialized<T> = T extends string
  ? string | JsonStringifiable
  : T extends (infer U)[]
    ? PreSerialized<U>[]
    : T extends object
      ? { [K in keyof T]: PreSerialized<T[K]> }
      : T;

/**
 * Type-safe wrapper around res.json() that accounts for JSON serialization.
 * Accepts ObjectId/Date values wherever the response type expects strings,
 * since res.json() (via JSON.stringify) converts them automatically.
 *
 * The type widening only happens here, ensuring it can't be misused
 * outside the context of sending a response.
 */
export function sendJson<TResponse>(
  res: express.Response<TResponse>,
  data: PreSerialized<TResponse>,
): void {
  res.json(data as unknown as TResponse);
}
