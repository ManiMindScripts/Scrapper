/**
 * Fast rule-based Seniority Classifier
 * Extracts seniority level from job title using deterministic pattern matching.
 */

export type SeniorityLevel =
  | "Intern / Co-op"
  | "Entry-Level / Junior"
  | "Mid-Level"
  | "Senior"
  | "Lead / Principal / Staff"
  | "Manager"
  | "Director"
  | "VP / Head of"
  | "C-Level / Executive";

export function parseSeniority(jobTitle: string): SeniorityLevel {
  if (!jobTitle || !jobTitle.trim()) {
    return "Mid-Level";
  }

  const title = ` ${jobTitle.toLowerCase().replace(/[^a-z0-9+#/]/g, " ")} `;

  // 1. Intern / Student / Co-op (Highest precedence to avoid "Engineering Intern" matching Engineer)
  if (/\b(intern|internship|co op|co-op|apprentice|student|trainee)\b/i.test(title)) {
    return "Intern / Co-op";
  }

  // 2. Entry-Level / Junior / Associate (e.g., "Associate Product Manager" -> Entry-Level)
  if (
    /\b(junior|jr|jr\.|entry level|entry-level|entry|associate|graduate|assistant)\b/i.test(
      title,
    )
  ) {
    return "Entry-Level / Junior";
  }

  // 3. VP / Vice President / Head of (Checked before generic "president" or "chief")
  if (/\b(vp|v\.p\.|vice president|vice-president|head of|head)\b/i.test(title)) {
    return "VP / Head of";
  }

  // 4. C-Level / Executive / Founders
  if (
    /\b(ceo|cto|cfo|coo|cpo|cmo|cro|cio|ciso|chief|founder|co founder|co-founder|founding|president|managing partner|general partner)\b/i.test(
      title,
    )
  ) {
    return "C-Level / Executive";
  }

  // 5. Director
  if (/\b(director|directeur)\b/i.test(title)) {
    return "Director";
  }

  // 6. Manager
  if (/\b(manager|mgr|engineering manager|product manager|program manager|operations manager)\b/i.test(title)) {
    return "Manager";
  }

  // 7. Lead / Principal / Staff / Architect
  if (
    /\b(lead|tech lead|team lead|principal|staff|distinguished|fellow|architect)\b/i.test(
      title,
    )
  ) {
    return "Lead / Principal / Staff";
  }

  // 8. Senior
  if (
    /\b(senior|sr|sr\.|iii|iv|v|expert|advanced)\b/i.test(
      title,
    )
  ) {
    return "Senior";
  }

  // Default to Mid-Level
  return "Mid-Level";
}
