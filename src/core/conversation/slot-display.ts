/**
 * slot-display.ts
 * Converts raw extracted slot values (from intent-classifier) into
 * natural Hindi/Hinglish display strings for use in response templates.
 *
 * Raw values produced by the classifier:
 *   date  → "tomorrow" | "day_after_tomorrow" | "next_week" | "monday" … "sunday" | "today"
 *   time  → "morning"  | "afternoon" | "evening" | "N AM" | "N PM"
 */

const DATE_MAP: Readonly<Record<string, string>> = {
  tomorrow:           'कल',
  day_after_tomorrow: 'परसों',
  next_week:          'अगले हफ्ते',
  today:              'आज',
  monday:             'सोमवार',
  tuesday:            'मंगलवार',
  wednesday:          'बुधवार',
  thursday:           'गुरुवार',
  friday:             'शुक्रवार',
  saturday:           'शनिवार',
  sunday:             'रविवार',
};

const PERIOD_MAP: Readonly<Record<string, string>> = {
  morning:   'सुबह',
  afternoon: 'दोपहर',
  evening:   'शाम',
  night:     'रात',
};

/**
 * Convert a raw date slot value to its Hindi display form.
 * Returns the original string unchanged if it is already localized or unknown.
 */
export const localizeDate = (date: string | undefined): string => {
  if (!date) return '';
  return DATE_MAP[date.toLowerCase().trim()] ?? date;
};

/**
 * Convert a raw time slot value to a Hindi display string.
 *   "morning"  → "सुबह"
 *   "11 AM"    → "11 बजे"
 *   "3 PM"     → "3 बजे"
 * Returns an empty string for undefined input.
 */
export const localizeTime = (time: string | undefined): string => {
  if (!time) return '';
  const t = time.toLowerCase().trim();
  if (PERIOD_MAP[t]) return PERIOD_MAP[t];
  const clockMatch = /^(\d{1,2})\s*(am|pm)$/.exec(t);
  if (clockMatch) return `${clockMatch[1]} बजे`;
  return time; // already Hindi or an unexpected format
};

/**
 * Build a combined date + time phrase for appointment/booking responses.
 *
 * Rules:
 *   - Period words (morning/afternoon/evening) are translated but do NOT get बजे.
 *   - Clock times ("11 AM") produce "N बजे" and are NOT double-suffixed.
 *   - Either part may be absent; the non-empty parts are joined with a space.
 *
 * Examples:
 *   ("tomorrow",  "morning")  → "कल सुबह"
 *   ("tomorrow",  "11 AM")    → "कल 11 बजे"
 *   ("tomorrow",  undefined)  → "कल"
 *   (undefined,   "afternoon")→ "दोपहर"
 *   (undefined,   undefined)  → ""
 */
export const formatTimePhrase = (
  date: string | undefined,
  time: string | undefined
): string => {
  const parts = [localizeDate(date), localizeTime(time)].filter(Boolean);
  return parts.join(' ');
};
