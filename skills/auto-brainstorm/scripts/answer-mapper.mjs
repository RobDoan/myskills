// Pure, IO-free. Maps a free-text agent reply into AskUserQuestion answers.
// See: docs/superpowers/specs/2026-04-22-multi-agent-hcom-brainstorming-design.md
// section "answer-mapper.mjs".

const LABEL_PATTERNS = [
  /^\s*(?:option\s+)?([a-z0-9]+)\s*(?:[.)]\s+|[:\-–—]|\n|$)/i,
  /\boption\s+([a-z0-9]+)\b/i,
];

const OTHER_PATTERN = /^\s*other\s*:\s*(.+)$/is;
const SPLIT_DASH = /\n\s*-{3,}\s*\n/;
const SPLIT_NUMBERED = /\n?\s*\d+\.\s+/;

function findLabel(text, options) {
  const firstLine = text.split('\n')[0] || '';
  for (const p of LABEL_PATTERNS) {
    const m = firstLine.match(p);
    if (!m) continue;
    const candidate = m[1].trim().toLowerCase();
    const hit = options.find((o) => o.label.toLowerCase() === candidate);
    if (hit) return hit.label;
  }
  return null;
}

function hasOther(options) {
  return options.some((o) => o.label.toLowerCase() === 'other');
}

function resolveOne(question, reply) {
  const trimmed = reply.trim();
  if (!trimmed) return { answer: null };

  const otherMatch = trimmed.match(OTHER_PATTERN);
  if (otherMatch && hasOther(question.options)) {
    return { answer: `Other: ${otherMatch[1].trim()}` };
  }

  const label = findLabel(trimmed, question.options);
  if (label) return { answer: label };

  if (hasOther(question.options)) {
    return { answer: `Other: ${trimmed}` };
  }

  return { answer: null };
}

function splitReply(reply, count) {
  if (count <= 1) return [reply];
  if (SPLIT_DASH.test(reply)) return reply.split(SPLIT_DASH).map((s) => s.trim());
  const numbered = reply.split(SPLIT_NUMBERED).map((s) => s.trim()).filter(Boolean);
  if (numbered.length === count) return numbered;
  return [reply];
}

export function buildAnswersMap(questions, reply) {
  const answers = {};
  const unmatched = [];

  const parts = splitReply(reply, questions.length);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const part = parts[i];
    if (part === undefined) {
      unmatched.push(q.question);
      continue;
    }
    const { answer } = resolveOne(q, part);
    if (answer === null) {
      unmatched.push(q.question);
    } else {
      answers[q.question] = answer;
    }
  }

  return { answers, unmatched };
}
