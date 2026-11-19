import type { AppliedGlossaryEntry, Glossary, GlossaryTerm } from '../shared/types.ts';

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseGlossaryCsv(csvText: string): Array<Omit<GlossaryTerm, 'id'>> {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const rows: Array<Omit<GlossaryTerm, 'id'>> = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const cols = parseCsvLine(line);
    if (cols.length < 2) return;
    const sourceTerm = cols[0];
    const targetTerm = cols[1];
    const notes = cols[2] ?? '';

    if (
      index === 0 &&
      sourceTerm.toLowerCase() === 'source' &&
      targetTerm.toLowerCase() === 'target'
    ) {
      return;
    }

    if (!sourceTerm || !targetTerm) return;
    const dedupKey = sourceTerm.toLowerCase();
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);

    rows.push({
      sourceTerm,
      targetTerm,
      ...(notes ? { notes } : {}),
    });
  });

  return rows;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportGlossaryToCsv(terms: GlossaryTerm[]): string {
  const header = 'source,target,notes';
  const rows = terms.map((term) =>
    [
      escapeCsvCell(term.sourceTerm),
      escapeCsvCell(term.targetTerm),
      escapeCsvCell(term.notes ?? ''),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findApplicableGlossaryTerms(
  text: string,
  glossaries: Glossary[],
  sourceLang: string,
  targetLang: string,
): AppliedGlossaryEntry[] {
  if (!text.trim()) return [];

  const activeGlossaries = glossaries.filter((g) => {
    if (!g.enabled) return false;
    const targetMatches = g.targetLang.toLowerCase() === targetLang.toLowerCase();
    const sourceMatches =
      sourceLang === 'auto' || g.sourceLang.toLowerCase() === sourceLang.toLowerCase();
    return targetMatches && sourceMatches;
  });

  const matched: AppliedGlossaryEntry[] = [];
  const seenSource = new Set<string>();

  for (const glossary of activeGlossaries) {
    for (const term of glossary.terms) {
      const key = term.sourceTerm.toLowerCase();
      if (seenSource.has(key)) continue;

      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(term.sourceTerm)}($|[^\\p{L}\\p{N}_])`, 'iu');
      if (pattern.test(text)) {
        seenSource.add(key);
        matched.push({
          sourceTerm: term.sourceTerm,
          targetTerm: term.targetTerm,
        });
      }
    }
  }

  return matched;
}
