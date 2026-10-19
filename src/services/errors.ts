export type BookingCode =
  | 'INVALID_DATES' | 'PAST_DATE' | 'TOO_LONG' | 'NO_AVAILABILITY' | 'NO_RATE' | 'NOT_FOUND' | 'BAD_STATE'
  | 'CONFLICT' | 'PAYMENT_REQUIRED' | 'INVALID_INPUT' | 'ROOM_TYPE_INACTIVE' | 'FORBIDDEN' | 'POLICY_BLOCKED';
export class BookingError extends Error {
  constructor(public code: BookingCode, message?: string, public detail?: unknown) { super(message ?? code); }
}
