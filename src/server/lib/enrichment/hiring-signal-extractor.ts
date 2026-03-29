/**
 * Deterministic hiring signal extractor for careers page markdown.
 *
 * Parses careers/jobs page content to extract structured hiring signals
 * WITHOUT LLM cost. Complements the LLM summarizer by catching structured
 * patterns (job titles, department groupings, position counts) that the
 * LLM might miss in a 15K char blob.
 *
 * Returns StructuredSignal[] that merge with LLM-extracted hiringSignals.
 */

// --- StructuredSignal type (inlined to avoid dependency on summarizer) ---

export interface StructuredSignal {
  detail: string;
  date: string | null;
  source: string | null;
}

// --- Role/seniority patterns ---

const SENIORITY_KEYWORDS = [
  "senior", "sr.", "lead", "principal", "staff",
  "director", "head of", "vp of", "vp ", "vice president",
  "chief", "c-level", "cto", "cfo", "coo", "cmo", "cpo", "cro",
  "manager", "architect", "fellow",
] as const;

const DEPARTMENT_KEYWORDS = [
  "engineering", "product", "design", "sales", "marketing",
  "customer success", "support", "operations", "finance",
  "people", "hr", "human resources", "legal", "data",
  "security", "devops", "infrastructure", "growth",
  "business development", "partnerships", "research",
] as const;

// Common job title patterns
const JOB_TITLE_PATTERNS = [
  /^[\s*\u2022\-\u2013\u2014]*([A-Z][A-Za-z &/,.\-()]+(?:Engineer|Developer|Designer|Manager|Director|Lead|Architect|Analyst|Specialist|Coordinator|Associate|Consultant|Strategist|Representative|Executive|Officer|Administrator|Recruiter|Writer|Editor|Scientist|Researcher|Intern))\s*$/gim,
  /^[\s*\u2022\-\u2013\u2014]*((?:Senior|Jr\.?|Junior|Lead|Principal|Staff|Head of|VP of|Director of)\s+[A-Z][A-Za-z &/,.\-()]+)\s*$/gim,
  /(?:hiring|looking for|seeking|recruiting|we need)\s+(?:a |an )?([A-Z][A-Za-z &/,.\-()]{5,50})/gi,
] as const;

// Growth language patterns
const GROWTH_PATTERNS = [
  /(?:rapidly |fast[- ])?growing\s+(?:\w+\s+){0,3}(?:team|company|organization)/i,
  /expanding\s+(?:our |the )?(?:\w+\s+){0,2}(?:team|engineering|sales|marketing|operations)/i,
  /(?:doubl|tripl)(?:ed?|ing)\s+(?:our |the )?(?:team|headcount|workforce)/i,
  /(?:hiring|recruit(?:ing)?)\s+(?:across|for)\s+(?:all|multiple|several)\s+(?:departments|teams|roles)/i,
  /(\d+)\+?\s+open\s+(?:positions?|roles?|opportunities)/i,
  /join\s+(?:a |our )?(?:team|company)\s+of\s+(\d+)/i,
] as const;

// --- Section extraction ---

export function extractCareersSection(combinedMarkdown: string): string | null {
  const marker = /^---\s*CAREERS\s*---$/im;
  const match = marker.exec(combinedMarkdown);
  if (!match) return null;

  const start = match.index + match[0].length;
  const nextSection = /^---\s*[A-Z/]+\s*---$/im.exec(combinedMarkdown.slice(start));
  const end = nextSection ? start + nextSection.index : combinedMarkdown.length;

  const section = combinedMarkdown.slice(start, end).trim();
  return section.length > 20 ? section : null;
}

// --- Signal extraction ---

export function extractJobTitles(markdown: string): string[] {
  const titles = new Set<string>();

  for (const pattern of JOB_TITLE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(markdown)) !== null) {
      const title = m[1]?.trim();
      if (title && title.length >= 5 && title.length <= 80) {
        if (/^(About|Our|The|We|Join|Apply|Learn|View|See|Read|More|Back|Next|Home|Contact)/i.test(title)) continue;
        if (/\.(com|org|io|ai|co)\b/i.test(title)) continue;
        titles.add(title);
      }
    }
  }

  return [...titles];
}

function detectSeniorityLevels(titles: string[]): string[] {
  const levels = new Set<string>();
  for (const title of titles) {
    const lower = title.toLowerCase();
    for (const kw of SENIORITY_KEYWORDS) {
      if (lower.includes(kw)) {
        levels.add(kw === "sr." ? "senior" : kw);
        break;
      }
    }
  }
  return [...levels];
}

function detectDepartments(titles: string[]): string[] {
  const depts = new Set<string>();
  const combined = titles.join(" ").toLowerCase();
  for (const dept of DEPARTMENT_KEYWORDS) {
    if (combined.includes(dept)) {
      depts.add(dept);
    }
  }
  return [...depts];
}

function detectGrowthSignals(markdown: string): string[] {
  const signals: string[] = [];
  for (const pattern of GROWTH_PATTERNS) {
    const match = pattern.exec(markdown);
    if (match) {
      signals.push(match[0].trim());
    }
  }
  return signals;
}

// --- Main extractor ---

export function extractHiringSignals(careersMarkdown: string): StructuredSignal[] {
  if (!careersMarkdown || careersMarkdown.trim().length < 30) return [];

  const signals: StructuredSignal[] = [];
  const titles = extractJobTitles(careersMarkdown);
  const departments = detectDepartments(titles);
  const seniorityLevels = detectSeniorityLevels(titles);
  const growthSignals = detectGrowthSignals(careersMarkdown);

  if (titles.length > 0) {
    const deptInfo = departments.length > 0 ? ` across ${departments.join(", ")}` : "";
    const seniorityInfo = seniorityLevels.length > 0 ? ` (${seniorityLevels.join(", ")}-level)` : "";
    signals.push({
      detail: `Hiring ${titles.length} roles${deptInfo}${seniorityInfo}`,
      date: null,
      source: "careers page",
    });
  }

  if (titles.length > 0) {
    const topTitles = titles.slice(0, 5);
    signals.push({
      detail: `Open positions: ${topTitles.join(", ")}${titles.length > 5 ? ` (+${titles.length - 5} more)` : ""}`,
      date: null,
      source: "careers page",
    });
  }

  for (const growth of growthSignals.slice(0, 2)) {
    signals.push({
      detail: growth,
      date: null,
      source: "careers page",
    });
  }

  if (departments.length >= 3) {
    signals.push({
      detail: `Expanding across ${departments.length} departments: ${departments.join(", ")}`,
      date: null,
      source: "careers page",
    });
  }

  return signals;
}

// --- Merge with LLM signals ---

export function mergeHiringSignals(
  llmSignals: StructuredSignal[],
  extractedSignals: StructuredSignal[],
): StructuredSignal[] {
  if (extractedSignals.length === 0) return llmSignals;
  if (llmSignals.length === 0) return extractedSignals;

  const merged = [...llmSignals];

  for (const extracted of extractedSignals) {
    const detailLower = extracted.detail.toLowerCase();
    const isDuplicate = llmSignals.some((llm) => {
      const llmLower = llm.detail.toLowerCase();
      if (llmLower.includes("careers page") && detailLower.includes("careers page")) {
        const words = detailLower.split(/\s+/).filter((w) => w.length > 4);
        const matchCount = words.filter((w) => llmLower.includes(w)).length;
        return matchCount >= 2;
      }
      return false;
    });

    if (!isDuplicate) {
      merged.push(extracted);
    }
  }

  return merged;
}
