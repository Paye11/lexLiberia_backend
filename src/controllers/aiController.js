const Document = require('../models/Document');
const { canUseAiResearch } = require('../utils/accessControl');
const extractDocumentText = require('../utils/extractDocumentText');

const STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'have',
  'about', 'please', 'provide', 'under', 'laws', 'law', 'liberia', 'liberian',
  'the', 'and', 'for', 'are', 'does', 'how', 'into', 'your', 'give', 'full',
  'text', 'specific', 'tell',
]);

function keywords(question) {
  return String(question || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
    .slice(0, 8);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function excerpt(text, words, max = 3500) {
  if (!text) return '';
  const lower = text.toLowerCase();
  let index = -1;

  words.forEach((word) => {
    const found = lower.indexOf(word);
    if (found !== -1 && (index === -1 || found < index)) index = found;
  });

  if (index === -1) return text.slice(0, max);
  const start = Math.max(0, index - 600);
  return text.slice(start, start + max);
}

async function ensureStoredText(document) {
  if (document.textContent && document.textContent.trim()) return document.textContent;

  const extracted = await extractDocumentText(document.filePath, document.fileType);
  if (!extracted) return '';

  document.textContent = extracted;
  await document.save();
  return extracted;
}

async function findRelevantDocuments(question) {
  const words = keywords(question);
  if (!words.length) return [];

  const clauses = words.map((word) => {
    const pattern = new RegExp(escapeRegex(word), 'i');
    return {
      $or: [{ title: pattern }, { description: pattern }, { textContent: pattern }],
    };
  });

  const documents = await Document.find({ $or: clauses }).limit(8);
  const ranked = documents
    .map((document) => {
      const haystack = `${document.title} ${document.description} ${document.textContent || ''}`.toLowerCase();
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
      return { document, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const results = [];
  for (const item of ranked) {
    const text = await ensureStoredText(item.document);
    results.push({
      id: String(item.document._id),
      title: item.document.title,
      description: item.document.description,
      category: item.document.category,
      excerpt: excerpt(text || item.document.description, words),
    });
  }

  return results;
}

function buildPrompt(question, documents) {
  const library = documents.length
    ? documents
        .map(
          (document, index) =>
            `Document ${index + 1}: ${document.title} (${document.category})\nID: ${document.id}\n${document.excerpt}`,
        )
        .join('\n\n---\n\n')
    : 'No uploaded LexLiberia document matched this question.';

  return `User question:\n${question}\n\nLaws stored on LexLiberia:\n${library}`;
}

function readResponsesPayload(data) {
  const parts = [];
  const webSources = [];

  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      for (const annotation of content.annotations || []) {
        if (annotation.type === 'url_citation' && annotation.url) {
          webSources.push({
            title: annotation.title || annotation.url,
            url: annotation.url,
          });
        }
      }
    }
  }

  const seen = new Set();
  return {
    content: parts.join('\n\n').trim(),
    webSources: webSources.filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    }),
  };
}

async function requestOpenAI(prompt, useWebSearch) {
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  const body = {
    model,
    instructions:
      'You are LexLiberia\'s legal research assistant. Search the public web for Liberian law, especially moj.gov.lr, supremecourt.gov.lr, liberlii.org, and other official Liberian legal sources. Also use the uploaded LexLiberia excerpts. When the user asks for a specific law, quote the relevant sections as fully as the sources allow, including section numbers and statutory wording, then add a short explanation. Do not invent citations, section numbers, or quotations. If the text was not found, say so.',
    input: prompt,
    max_output_tokens: 4000,
  };

  if (useWebSearch) {
    body.tools = [{ type: 'web_search' }];
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

exports.research = async (req, res) => {
  try {
    const question = String(req.body.question || '').trim();
    if (!question) {
      return res.status(400).json({ success: false, message: 'Please enter a legal question.' });
    }
    if (question.length > 4000) {
      return res.status(400).json({ success: false, message: 'Please shorten the question.' });
    }
    if (!canUseAiResearch(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'AI Research is available to the admin and to subscribers on a paid plan.',
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'The AI service is not configured yet.',
      });
    }

    const documents = await findRelevantDocuments(question);
    const prompt = buildPrompt(question, documents);
    let result = await requestOpenAI(prompt, true);
    let webSearchUsed = true;

    const toolError = JSON.stringify(result.data?.error || result.data || '');
    if (!result.ok && /tool|web_search/i.test(toolError)) {
      result = await requestOpenAI(prompt, false);
      webSearchUsed = false;
    }

    if (!result.ok) {
      const message = result.data?.error?.message || 'The AI service could not complete this search.';
      return res.status(result.status || 502).json({ success: false, message });
    }

    const parsed = readResponsesPayload(result.data);
    if (!parsed.content) {
      return res.status(502).json({
        success: false,
        message: 'The AI service returned an empty answer. Please try the question again.',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        content: parsed.content,
        webSearchUsed,
        webSources: parsed.webSources,
        citations: documents
          .filter((document) => document.excerpt)
          .map((document) => ({
            title: document.title,
            citation: document.category,
            href: `/documents/${document.id}`,
          })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
