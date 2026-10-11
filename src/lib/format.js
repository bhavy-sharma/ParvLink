import { STUDY_YEAR_MAX, STUDY_YEAR_MIN } from "@/lib/validation/limits";

const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd" };

export function yearLabel(year) {
  return `${ORDINAL[year] ?? `${year}th`} year`;
}

export const STUDY_YEARS = Array.from({ length: STUDY_YEAR_MAX - STUDY_YEAR_MIN + 1 }, (_, i) => STUDY_YEAR_MIN + i);

export function collegeLabel(college) {
  if (!college) return "";
  return college.city ? `${college.name}, ${college.city}` : college.name;
}
