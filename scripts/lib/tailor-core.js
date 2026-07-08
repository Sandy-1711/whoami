// Deterministic engine shared by both modes: extract the skills a JD asks for,
// score how well the resume covers them, and safely inject tailored content
// into the resume's TAILOR anchor blocks. The Gemini engine reuses the scoring
// and injection helpers; only the phrasing of summary/subtitle differs.

// Broad lexicon so JD keyword extraction works across SWE/AI/full-stack roles.
// (Canonical spellings; ALIASES below fold common variants onto these.)
export const TECH_LEXICON = [
  'AI agents', 'agent infrastructure', 'agentic workflows', 'agent orchestration', 'LLM', 'LLMs',
  'large language models', 'RAG', 'retrieval-augmented generation', 'semantic search', 'vector databases',
  'embeddings', 'memory systems', 'semantic recall', 'streaming', 'tool calling', 'prompt engineering',
  'context engineering', 'LLM evaluation', 'evals', 'fine-tuning', 'LoRA', 'QLoRA', 'PEFT', 'quantization',
  'multimodal', 'transformers', 'observability', 'Langfuse', 'promptfoo', 'LlamaIndex', 'LangChain',
  'Hugging Face', 'OpenAI API', 'Gemini API', 'Anthropic', 'Claude', 'Pinecone', 'Qdrant', 'Weaviate',
  'Chroma', 'PyTorch', 'TensorFlow', 'scikit-learn', 'pandas', 'NumPy', 'MLOps',
  'Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Java', 'C++', 'SQL', 'Bash',
  'FastAPI', 'Flask', 'Django', 'Node.js', 'Express', 'NestJS', 'asyncio', 'REST APIs', 'GraphQL',
  'gRPC', 'API design', 'WebSockets', 'Socket.io', 'microservices', 'distributed systems', 'concurrency',
  'event-driven', 'message queue', 'Kafka', 'RabbitMQ', 'Pub/Sub', 'Celery',
  'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'caching', 'database design', 'Prisma', 'SQLAlchemy',
  'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Lambda', 'S3', 'Cloudinary', 'Firebase', 'serverless',
  'Vercel', 'Terraform', 'CI/CD', 'GitHub Actions', 'Jenkins', 'unit testing', 'integration testing',
  'test coverage', 'pytest', 'Jest', 'TDD',
  'JWT', 'authentication', 'authorization', 'RBAC', 'OAuth', 'SSO', 'rate limiting', 'security', 'encryption',
  'Next.js', 'React', 'React Native', 'Expo', 'Vue.js', 'Angular', 'Svelte', 'Tailwind CSS', 'Shadcn/UI',
  'Redux', 'server-side rendering', 'responsive design', 'accessibility', 'SEO',
  'open source', 'code review', 'performance optimization', 'latency', 'scalability', 'reliability',
  'real-time', 'Agile', 'Scrum', 'system design',
];

const ALIASES = {
  'postgres': 'PostgreSQL', 'postgresql': 'PostgreSQL', 'psql': 'PostgreSQL',
  'js': 'JavaScript', 'ts': 'TypeScript', 'nodejs': 'Node.js', 'node': 'Node.js',
  'reactjs': 'React', 'react.js': 'React', 'react native': 'React Native', 'rn': 'React Native',
  'nextjs': 'Next.js', 'next': 'Next.js', 'k8s': 'Kubernetes', 'gcp': 'GCP',
  'restful': 'REST APIs', 'rest api': 'REST APIs', 'rest': 'REST APIs', 'websocket': 'WebSockets',
  'socketio': 'Socket.io', 'ci cd': 'CI/CD', 'cicd': 'CI/CD', 'github action': 'GitHub Actions',
  'rbac': 'RBAC', 'jwt': 'JWT', 'oauth': 'OAuth', 'oauth2': 'OAuth', 'llm': 'LLM', 'llms': 'LLMs',
  'rag': 'RAG', 'genai': 'LLM', 'generative ai': 'LLM', 'gen ai': 'LLM', 'vector db': 'vector databases',
  'vector database': 'vector databases', 'fine tuning': 'fine-tuning', 'finetuning': 'fine-tuning',
  'huggingface': 'Hugging Face', 'openai': 'OpenAI API', 'gemini': 'Gemini API', 'pubsub': 'Pub/Sub',
  'unit test': 'unit testing', 'unit tests': 'unit testing', 'integration test': 'integration testing',
  'micro-services': 'microservices', 'micro services': 'microservices', 'ssr': 'server-side rendering',
};

// Does `term` occur in `text`, not glued inside a larger token? Handles the
// dotted/plus/slash terms (Node.js, CI/CD, C++) that \b would mishandle.
export function termInText(term, text) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9+#.])${esc}(?![A-Za-z0-9+#.])`, 'i');
  return re.test(text);
}

// The canonical skills a JD asks for (dedup, alias-folded).
export function extractJdKeywords(jd) {
  const found = new Set();
  const lower = ' ' + jd.toLowerCase() + ' ';
  for (const [alias, canon] of Object.entries(ALIASES)) {
    if (termInText(alias, lower)) found.add(canon);
  }
  for (const term of TECH_LEXICON) {
    if (termInText(term, jd)) found.add(term);
  }
  return [...found];
}

// Flatten the fact base into the set of things the user can truthfully claim.
export function factIndex(facts) {
  const set = new Set();
  const add = (s) => s && set.add(String(s).toLowerCase());
  (facts.allowed_keywords || []).forEach(add);
  Object.values(facts.skills || {}).flat().forEach(add);
  for (const grp of [...(facts.experience || []), ...(facts.projects || [])]) {
    (grp.keywords || []).forEach(add);
  }
  // Fold aliases in too, so "postgres" in a JD matches "PostgreSQL" in facts.
  for (const [alias, canon] of Object.entries(ALIASES)) {
    if (set.has(canon.toLowerCase())) set.add(alias.toLowerCase());
  }
  return set;
}

export function classify(jdKeywords, resumeText, facts) {
  const idx = factIndex(facts);
  const matched = [], addable = [], missing = [];
  for (const k of jdKeywords) {
    if (termInText(k, resumeText)) matched.push(k);
    else if (idx.has(k.toLowerCase())) addable.push(k);
    else missing.push(k);
  }
  return { matched, addable, missing };
}

// Transparent ATS-style score: 20 pts structure + 80 pts keyword coverage.
export function scoreResume({ matched, addable, missing }, structurePoints = 20) {
  const total = matched.length + addable.length + missing.length;
  const cov = (n) => (total === 0 ? 1 : n / total);
  const before = Math.round(structurePoints + 80 * cov(matched.length));
  const after = Math.round(structurePoints + 80 * cov(matched.length + addable.length));
  return { before: Math.min(100, before), after: Math.min(100, after), total };
}

// ---- LaTeX injection --------------------------------------------------------

export function latexEscape(s) {
  return String(s)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// Escape text, then bold the first occurrence of each term (case-insensitive).
export function boldify(text, terms = []) {
  let out = latexEscape(text);
  for (const t of terms) {
    const esc = latexEscape(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${esc})`, 'i');
    out = out.replace(re, '\\textbf{$1}');
  }
  return out;
}

// Replace the content between `%% >>>TAILOR:key` and `%% <<<TAILOR:key`.
export function replaceBlock(tex, key, newContent) {
  const re = new RegExp(
    `(%%\\s*>>>TAILOR:${key}[^\\n]*\\n)[\\s\\S]*?(\\n\\s*%%\\s*<<<TAILOR:${key})`,
  );
  if (!re.test(tex)) throw new Error(`TAILOR anchor "${key}" not found in resume.tex`);
  return tex.replace(re, `$1${newContent}$2`);
}

// Higher-signal-first ranking so the offline engine surfaces AI/agent terms
// ahead of generic backend/frontend ones (matches the candidate's positioning).
export const PRIORITY = [
  'agent infrastructure', 'AI agents', 'agentic workflows', 'agent orchestration',
  'RAG', 'retrieval-augmented generation', 'LLM', 'LLMs', 'memory systems', 'semantic recall',
  'streaming', 'tool calling', 'LLM evaluation', 'fine-tuning', 'vector databases', 'observability',
  'FastAPI', 'Node.js', 'REST APIs', 'WebSockets', 'microservices', 'PostgreSQL', 'MongoDB', 'Redis',
  'Docker', 'CI/CD', 'authentication', 'RBAC', 'Next.js', 'React', 'React Native', 'TypeScript', 'Python',
];
const rank = (k) => { const i = PRIORITY.indexOf(k); return i === -1 ? 999 : i; };
export const rankByPriority = (terms) => [...terms].sort((a, b) => rank(a) - rank(b));

const AI_SIGNAL = ['llm', 'llms', 'rag', 'retrieval-augmented generation', 'ai agents', 'agent infrastructure',
  'agentic workflows', 'agent orchestration', 'memory systems', 'semantic recall', 'fine-tuning',
  'vector databases', 'tool calling', 'prompt engineering', 'llm evaluation'];
const FS_SIGNAL = ['react', 'react native', 'next.js', 'frontend', 'tailwind css', 'vue.js', 'responsive design', 'angular', 'svelte'];

// Lead framing: AI Engineer unless the JD is clearly more full-stack than AI.
export function leadTitle(jdKeywords) {
  const jl = jdKeywords.map((k) => k.toLowerCase());
  const ai = jl.filter((k) => AI_SIGNAL.includes(k)).length;
  const fs = jl.filter((k) => FS_SIGNAL.includes(k)).length;
  return fs > ai ? 'Full-Stack Engineer' : 'AI Engineer';
}

// Deterministic (offline) summary: lead framing + the true metric snippets whose
// keywords best match the JD.
export function offlineSummary(facts, jdKeywords) {
  const jl = jdKeywords.map((k) => k.toLowerCase());
  const scoreMetric = (m) => jl.filter((k) => m.toLowerCase().includes(k)).length;
  const ranked = [...facts.headline_metrics].sort((a, b) => scoreMetric(b) - scoreMetric(a));
  return `${leadTitle(jdKeywords)} building agentic LLM systems, memory, and RAG --- ${ranked.slice(0, 3).join(', ')}.`;
}
