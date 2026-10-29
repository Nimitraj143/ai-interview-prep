// Heuristic ATS scoring. Real ATS products differ from each other, so this is an
// estimate of how well a resume is structured and how well it matches a job description.

const STOPWORDS = new Set((
  'a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its ' +
  'we you your our their they he she them us i me my not no yes can could should would will shall may might must do does did ' +
  'have has had having about into over under more most less least than then also such other any all each per via within ' +
  'across including include includes etc ability able strong good great excellent required requirements preferred plus ' +
  'responsibilities responsibility role job position candidate candidates team teams work working works experience experiences ' +
  'years year months skills skill knowledge understanding looking join company business opportunity environment ensure ' +
  'help support develop developing development build building use using used new make making drive including well ' +
  'hiring seeking apply must-have nice have-to who what when where why how which while both either etc eg ie'
).split(/\s+/));

const ACTION_VERBS = new Set((
  'achieved administered analyzed architected automated built collaborated conducted configured contributed coordinated created ' +
  'debugged delivered deployed designed developed directed drove enhanced engineered established evaluated executed expanded ' +
  'facilitated generated implemented improved increased initiated integrated introduced launched led maintained managed mentored ' +
  'migrated modernized monitored negotiated optimized orchestrated organized owned partnered planned produced programmed reduced ' +
  'refactored released researched resolved restructured reviewed scaled secured shipped simplified solved spearheaded streamlined ' +
  'supported tested trained transformed troubleshot upgraded validated wrote'
).split(/\s+/));

const SECTION_PATTERNS = {
  summary: /^(professional |career )?(summary|objective|profile|about me)\b/,
  experience: /^(professional |work |relevant )?(experience|employment|work history|internships?)\b/,
  projects: /^(academic |personal |key )?projects?\b/,
  education: /^(education|academic|qualifications?)\b/,
  skills: /^(technical |key |core )?(skills|technologies|tech stack|competencies)\b/
};

// ---------- text helpers ----------

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.\-_]/g, '') // node.js -> nodejs, front-end -> frontend
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(normalizedText, term) {
  const t = normalize(term);
  if (!t) return false;
  // word-boundary aware (keeps c++ / c# intact) and tolerates a plural "s"
  const re = new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(t)}s?($|[^a-z0-9+#])`);
  return re.test(normalizedText);
}

function countWords(text) {
  return (text.match(/\S+/g) || []).length;
}

function cleanLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
}

function stripBullet(line) {
  return line.replace(/^[\s•●▪◦‣·*•\-–—>▪●○◦]+/, '').trim();
}

// ---------- keyword preparation ----------

// Turns Gemini's categorised output into [{term, weight}] (hard skills / titles count double).
function buildKeywordList(extracted) {
  const groups = [
    ['hardSkills', 2],
    ['jobTitles', 2],
    ['softSkills', 1],
    ['otherKeywords', 1]
  ];
  const seen = new Set();
  const list = [];
  for (const [key, weight] of groups) {
    const arr = Array.isArray(extracted?.[key]) ? extracted[key] : [];
    for (const item of arr) {
      const term = String(item || '').trim();
      const norm = normalize(term);
      if (!term || term.length > 40 || !norm || seen.has(norm)) continue;
      seen.add(norm);
      list.push({ term, weight });
      if (list.length >= 40) return list;
    }
  }
  return list;
}

// Fallback when AI is unavailable: most frequent meaningful words in the JD.
function fallbackKeywords(jobDescription) {
  const words = String(jobDescription || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g) || [];
  const freq = new Map();
  const order = new Map();
  words.forEach((w, i) => {
    const clean = w.replace(/\.+$/, '');
    if (clean.length < 2 || STOPWORDS.has(clean)) return;
    freq.set(clean, (freq.get(clean) || 0) + 1);
    if (!order.has(clean)) order.set(clean, i);
  });
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || order.get(a[0]) - order.get(b[0]))
    .slice(0, 25)
    .map(([term]) => ({ term, weight: 1 }));
}

// ---------- scoring ----------

function scoreSections(lines) {
  const found = {};
  for (const [name, re] of Object.entries(SECTION_PATTERNS)) {
    found[name] = lines.some(l => l.length <= 40 && re.test(l.toLowerCase().replace(/[:|]/g, '').trim()));
  }
  const hasExpOrProjects = found.experience || found.projects;
  let score = 0;
  const missing = [];
  if (found.education) score += 4; else missing.push('Education');
  if (found.skills) score += 4; else missing.push('Skills');
  if (hasExpOrProjects) score += 4; else missing.push('Experience / Projects');
  if (found.summary) score += 3; else missing.push('Summary');
  return { score, missing };
}

function scoreContact(text) {
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text);
  const phone = /(\+?\d[\d\s().-]{8,}\d)/.test(text);
  const link = /linkedin\.com|github\.com/i.test(text);
  const missing = [];
  let score = 0;
  if (email) score += 4; else missing.push('email');
  if (phone) score += 3; else missing.push('phone number');
  if (link) score += 3; else missing.push('LinkedIn/GitHub link');
  return { score, missing };
}

function scoreImpact(lines) {
  let verbLines = 0;
  let metricLines = 0;
  for (const line of lines) {
    const body = stripBullet(line);
    const first = (body.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (ACTION_VERBS.has(first)) verbLines++;
    if (/\d+\s*%|[$₹€£]\s?\d|\b\d{2,}\+?\b|\b\d+\s*(x|k|m)\b/i.test(body) && body.split(/\s+/).length >= 5) metricLines++;
  }
  const actionPart = Math.min(1, verbLines / 6) * 8;
  const metricPart = Math.min(1, metricLines / 3) * 7;
  return { score: Math.round((actionPart + metricPart) * 10) / 10, verbLines, metricLines };
}

function scoreFormat(text, lines) {
  const words = countWords(text);
  let score = 0;

  // length: 350-900 words is the sweet spot for a 1-2 page resume
  if (words >= 350 && words <= 900) score += 6;
  else if ((words >= 200 && words < 350) || (words > 900 && words <= 1200)) score += 3;

  // bullet-style lines
  const bulletLines = lines.filter(l => /^[\s•●▪◦‣·*•\-–—▪●○◦]\s*\S/.test(l)).length;
  if (bulletLines >= 4) score += 4;

  // odd characters (icons, tables, broken encoding) that ATS parsers choke on
  const stripped = text.replace(/[•●▪◦‣·–—‘’“”₹€£]/g, '');
  const odd = (stripped.match(/[^\x09\x0A\x0D\x20-\x7E]/g) || []).length;
  if (stripped.length && odd / stripped.length < 0.02) score += 3;

  // dates present (work history timeline)
  const years = text.match(/\b(19|20)\d{2}\b/g) || [];
  if (years.length >= 2) score += 2;

  return { score, words, bulletLines };
}

function scoreKeywords(normalizedText, keywords) {
  const matched = [];
  const missing = [];
  let totalWeight = 0;
  let matchedWeight = 0;
  for (const k of keywords) {
    totalWeight += k.weight;
    if (containsTerm(normalizedText, k.term)) {
      matched.push(k.term);
      matchedWeight += k.weight;
    } else {
      missing.push(k.term);
    }
  }
  const ratio = totalWeight ? matchedWeight / totalWeight : 0;
  return { ratio, matched, missing };
}

function scoreResume(resumeText, keywords) {
  const text = String(resumeText || '');
  const lines = cleanLines(text);
  const normalized = normalize(text);
  const hasKeywords = Array.isArray(keywords) && keywords.length > 0;

  const sections = scoreSections(lines);
  const contact = scoreContact(text);
  const impact = scoreImpact(lines);
  const format = scoreFormat(text, lines);

  const breakdown = [];
  let matched = [];
  let missing = [];

  if (hasKeywords) {
    const kw = scoreKeywords(normalized, keywords);
    matched = kw.matched;
    missing = kw.missing;
    breakdown.push({
      key: 'keywords',
      label: 'Job description keywords',
      score: Math.round(kw.ratio * 45 * 10) / 10,
      max: 45,
      note: `${kw.matched.length} of ${keywords.length} keywords found`
    });
  }
  breakdown.push(
    { key: 'sections', label: 'Standard sections', score: sections.score, max: 15,
      note: sections.missing.length ? `Missing: ${sections.missing.join(', ')}` : 'All key sections found' },
    { key: 'contact', label: 'Contact details', score: contact.score, max: 10,
      note: contact.missing.length ? `Missing: ${contact.missing.join(', ')}` : 'Email, phone and profile link found' },
    { key: 'impact', label: 'Action verbs & results', score: impact.score, max: 15,
      note: `${impact.verbLines} action-verb lines, ${impact.metricLines} lines with numbers` },
    { key: 'format', label: 'Length & formatting', score: format.score, max: 15,
      note: `${format.words} words` }
  );

  const earned = breakdown.reduce((s, b) => s + b.score, 0);
  const possible = breakdown.reduce((s, b) => s + b.max, 0);
  const score = Math.round((earned / possible) * 100);

  // ---- suggestions ----
  const suggestions = [];
  if (format.words < 80) {
    suggestions.push('Very little text could be read. If your resume is a scanned image, ATS cannot read it. Export a text-based PDF or DOCX.');
  }
  if (hasKeywords && missing.length) {
    suggestions.push(`Add these job-description keywords where they truthfully apply: ${missing.slice(0, 10).join(', ')}.`);
  }
  if (sections.missing.length) suggestions.push(`Add clear section headings for: ${sections.missing.join(', ')}.`);
  if (contact.missing.length) suggestions.push(`Add your ${contact.missing.join(', ')} near the top.`);
  if (impact.verbLines < 6) suggestions.push('Start more bullet points with strong action verbs (built, led, reduced, deployed...).');
  if (impact.metricLines < 3) suggestions.push('Quantify your impact with numbers (percentages, users, time saved, revenue).');
  if (format.words >= 80 && format.words < 200) suggestions.push('Your resume looks short. Add more detail about projects, responsibilities and tools used.');
  if (format.words > 900) suggestions.push('Your resume is long. Aim for 1-2 pages and cut older or less relevant details.');
  if (format.bulletLines < 4 && format.words >= 80) suggestions.push('Use bullet points for experience and projects, since they are easier for ATS and recruiters to scan.');

  return {
    score,
    breakdown,
    keywords: { matched, missing },
    suggestions
  };
}

module.exports = { scoreResume, buildKeywordList, fallbackKeywords, normalize };