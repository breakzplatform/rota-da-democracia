import { ELECTION } from "./config";

export const windowStart = new Date(ELECTION.rideWindowStart);
export const windowEnd = new Date(ELECTION.rideWindowEnd);
export const purgeAt = new Date(ELECTION.purgeAt);
export const signupClosesAt = new Date(ELECTION.signupClosesAt);

// The UTC offset the UI uses for election day, taken from the configured window ("-03:00").
const ELECTION_OFFSET = ELECTION.rideWindowStart.slice(-6);

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClosed(now: Date): boolean {
  return now.getTime() >= purgeAt.getTime();
}

export function isSignupClosed(now: Date): boolean {
  return now.getTime() >= signupClosesAt.getTime();
}

/** Parses an ISO timestamp that carries an explicit offset; null when malformed. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isInsideRideWindow(date: Date): boolean {
  const time = date.getTime();
  return time >= windowStart.getTime() && time <= windowEnd.getTime();
}

/** Converts an election-day local "HH:MM" into an instant; null when malformed. */
export function electionDayTime(value: string): Date | null {
  if (!CLOCK_TIME.test(value)) return null;
  return new Date(`${ELECTION.date}T${value}:00${ELECTION_OFFSET}`);
}
