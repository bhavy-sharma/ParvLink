// Date helpers that work on plain "YYYY-MM-DD" strings, so a date of birth is
// never shifted by a timezone conversion.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" into { year, month, day }, or null if it is not a real calendar date. */
export function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Whole years between a "YYYY-MM-DD" date of birth and today (UTC, like the database). */
export function ageOn(dobIso, now = new Date()) {
  const dob = parseIsoDate(dobIso);
  if (!dob) return null;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  let age = year - dob.year;
  if (month < dob.month || (month === dob.month && day < dob.day)) age -= 1;
  return age;
}

/** Latest date of birth that is at least `years` old today, as "YYYY-MM-DD". */
export function latestDobForAge(years, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

// Timestamps are shown in one fixed zone so every screen agrees (pages are
// rendered on the server, which does not know the viewer's zone).
const DISPLAY_TIME_ZONE = process.env.NEXT_PUBLIC_APP_TIME_ZONE || "Asia/Kolkata";

function format(date, options) {
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", options).format(date);
  } catch {
    // An invalid NEXT_PUBLIC_APP_TIME_ZONE must not break a page.
    return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "UTC" }).format(date);
  }
}

/** "9 Oct 2026". A plain "YYYY-MM-DD" value (a date of birth) is never shifted by a time zone. */
export function formatDate(value) {
  if (!value) return "";
  const options = { day: "numeric", month: "short", year: "numeric" };
  if (typeof value === "string" && parseIsoDate(value)) {
    return format(new Date(`${value}T00:00:00Z`), { ...options, timeZone: "UTC" });
  }
  return format(new Date(value), { ...options, timeZone: DISPLAY_TIME_ZONE });
}

/** "9 Oct, 6:10 pm" in the app's display time zone. */
export function formatDateTime(value) {
  if (!value) return "";
  return format(new Date(value), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}

/** "6:10 pm" in the app's display time zone. */
export function formatTime(value) {
  if (!value) return "";
  return format(new Date(value), { hour: "numeric", minute: "2-digit", timeZone: DISPLAY_TIME_ZONE });
}

// ---------------------------------------------------------------------------
// Event date-times
// ---------------------------------------------------------------------------
// Admins type event times as wall-clock time in the app's display zone (a
// <input type="datetime-local"> has no zone of its own). These helpers convert
// between that and the UTC instants stored in the database.

export const APP_TIME_ZONE = DISPLAY_TIME_ZONE;

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

function safeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Minutes that `timeZone` is ahead of UTC at the given instant. */
function zoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** "2026-10-17T19:30" typed in the app's zone → Date (or null if it is not a real date-time). */
export function zonedInputToDate(value, timeZone = DISPLAY_TIME_ZONE) {
  if (typeof value !== "string") return null;
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (!parseIsoDate(`${match[1]}-${match[2]}-${match[3]}`) || hour > 23 || minute > 59) return null;

  const zone = safeZone(timeZone);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes so a daylight-saving change between the guess and the answer is handled.
  let instant = wallClock - zoneOffsetMinutes(new Date(wallClock), zone) * 60000;
  instant = wallClock - zoneOffsetMinutes(new Date(instant), zone) * 60000;
  return new Date(instant);
}

/** Stored instant → "YYYY-MM-DDTHH:mm" in the app's zone, for a datetime-local input. */
export function dateToZonedInput(value, timeZone = DISPLAY_TIME_ZONE) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const zone = safeZone(timeZone);
  const shifted = new Date(date.getTime() + zoneOffsetMinutes(date, zone) * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** "Sat, 17 Oct 2026, 7:30 pm" */
export function formatDateTimeLong(value) {
  if (!value) return "";
  return format(new Date(value), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

/** "Sat, 17 Oct 2026, 7:30 pm – 11:00 pm", or both full date-times when the event spans days. */
export function formatEventRange(startsAt, endsAt) {
  const start = formatDateTimeLong(startsAt);
  if (!endsAt) return start;
  const sameDay = formatDate(startsAt) === formatDate(endsAt);
  const end = sameDay
    ? format(new Date(endsAt), { hour: "numeric", minute: "2-digit", timeZone: DISPLAY_TIME_ZONE })
    : formatDateTimeLong(endsAt);
  return `${start} – ${end}`;
}

/** Short name of the display zone at that moment, e.g. "IST". */
export function timeZoneLabel(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: safeZone(DISPLAY_TIME_ZONE), timeZoneName: "short" }).formatToParts(new Date(value));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? DISPLAY_TIME_ZONE;
}
