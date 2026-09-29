const Document = require('../models/Document');
const { canUseAiResearch } = require('../utils/accessControl');
const extractDocumentText = require('../utils/extractDocumentText');
const { extractBufferText, isImageUpload } = extractDocumentText;

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

function buildPrompt(question, documents, pleadingText, hasImage) {
  const library = documents.length
    ? documents
        .map(
          (document, index) =>
            `Document ${index + 1}: ${document.title} (${document.category})\nID: ${document.id}\n${document.excerpt}`,
        )
        .join('\n\n---\n\n')
    : 'No uploaded LexLiberia document matched this question.';

  const pleadingBlock = pleadingText || hasImage
    ? `\n\nSubscriber pleading to read and answer or draft from:\n${
        pleadingText
          ? pleadingText.slice(0, 50000)
          : 'The pleading is in the attached image. Read the image.'
      }\n`
    : '';

  return `User question:\n${question}${pleadingBlock}\n\nPrimary legal source — laws uploaded on LexLiberia. Quote these first when they match:\n${library}\n\nThen search these official pages before any general web result:\n1. Supreme Court of Liberia opinions: https://judiciary.gov.lr/opinions/\n2. LiberLII: https://www.liberlii.org/\n\nAfter those, search the wider public web.`;
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

async function requestOpenAI(prompt, useWebSearch, images = []) {
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  const body = {
    model,
    instructions:
      'You are LexLiberia\'s legal research assistant. If the subscriber attaches a pleading or a photo of a pleading, read the whole attachment first and answer or draft exactly what they asked, using the facts in that pleading. For the law, use sources in this order: (1) laws uploaded on LexLiberia; (2) Supreme Court of Liberia opinions at https://judiciary.gov.lr/opinions/ ; (3) LiberLII at https://www.liberlii.org/ ; (4) the wider public web. Search site:judiciary.gov.lr/opinions and site:liberlii.org before a general search. Quote relevant statutory or opinion text, with section or case numbers, and label the source. Do not invent citations, section numbers, or quotations. If a source does not contain the text, say it was not found there.',
    input: images.length
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              ...images.map((image) => ({
                type: 'input_image',
                image_url: image.dataUrl,
              })),
            ],
          },
        ]
      : prompt,
    max_output_tokens: 4000,
  };

  if (useWebSearch) {
    body.tools = [{ type: 'web_search', search_context_size: 'high' }];
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

    let pleadingText = '';
    const images = [];

    if (req.file) {
      const imageUpload = isImageUpload(req.file.originalname, req.file.mimetype);
      if (imageUpload) {
        const mime = req.file.mimetype || 'image/jpeg';
        images.push({
          dataUrl: `data:${mime};base64,${req.file.buffer.toString('base64')}`,
        });
      }

      pleadingText = await extractBufferText(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );

      if (!pleadingText && !imageUpload) {
        return res.status(400).json({
          success: false,
          message: 'The file could not be read. Upload a PDF, a Word document, or a clear photo of the pleading.',
        });
      }
    }

    const documents = await findRelevantDocuments(question);
    const prompt = buildPrompt(question, documents, pleadingText, images.length > 0);
    let result = await requestOpenAI(prompt, true, images);
    let webSearchUsed = true;

    const toolError = JSON.stringify(result.data?.error || result.data || '');
    if (!result.ok && /tool|web_search/i.test(toolError)) {
      result = await requestOpenAI(prompt, false, images);
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
        citations: documentCitations(documents),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

function documentCitations(documents) {
  return documents
    .filter((document) => document.excerpt)
    .map((document) => ({
      title: document.title,
      citation: document.category,
      href: `/documents/${document.id}`,
    }));
}

function readPerplexityPayload(data) {
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  const webSources = [];

  for (const item of data?.citations || []) {
    if (typeof item === 'string' && item) {
      webSources.push({ title: item, url: item });
    } else if (item?.url) {
      webSources.push({ title: item.title || item.url, url: item.url });
    }
  }

  for (const item of data?.search_results || []) {
    if (item?.url) {
      webSources.push({ title: item.title || item.url, url: item.url });
    }
  }

  const seen = new Set();
  return {
    content,
    webSources: webSources.filter((source) => {
      if (!source.url || seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    }),
  };
}

async function requestPerplexity(prompt, images = []) {
  const model = process.env.PERPLEXITY_MODEL || 'sonar-pro';
  const userContent = images.length
    ? [
        { type: 'text', text: prompt },
        ...images.map((image) => ({
          type: 'image_url',
          image_url: { url: image.dataUrl },
        })),
      ]
    : prompt;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are Ask Me, LexLiberia\'s search assistant for the admin and paid subscribers. If a pleading or photo is attached, read it first and answer or draft what was asked. For the law, use sources in this order: (1) the LexLiberia uploads included in the question; (2) Supreme Court of Liberia opinions at https://judiciary.gov.lr/opinions/ and the wider judiciary.gov.lr site; (3) LiberLII at https://www.liberlii.org/ ; (4) the wider public web, including other Liberian legal sites. Search those judiciary and LiberLII pages before a general search. Quote section or case text when a source contains it, and label the source with its link. Do not invent citations, section numbers, or quotations. If a source does not contain the text, say it was not found there.',
        },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

exports.ask = async (req, res) => {
  try {
    const question = String(req.body.question || '').trim();
    if (!question) {
      return res.status(400).json({ success: false, message: 'Please enter a question.' });
    }
    if (question.length > 4000) {
      return res.status(400).json({ success: false, message: 'Please shorten the question.' });
    }
    if (!canUseAiResearch(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Ask Me is available to the admin and to subscribers on a paid plan.',
      });
    }
    if (!process.env.PERPLEXITY_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Ask Me is not configured yet.',
      });
    }

    let pleadingText = '';
    const images = [];

    if (req.file) {
      const imageUpload = isImageUpload(req.file.originalname, req.file.mimetype);
      if (imageUpload) {
        const mime = req.file.mimetype || 'image/jpeg';
        images.push({
          dataUrl: `data:${mime};base64,${req.file.buffer.toString('base64')}`,
        });
      }

      pleadingText = await extractBufferText(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );

      if (!pleadingText && !imageUpload) {
        return res.status(400).json({
          success: false,
          message: 'The file could not be read. Upload a PDF, a Word document, or a clear photo of the pleading.',
        });
      }
    }

    const documents = await findRelevantDocuments(question);
    const prompt = buildPrompt(question, documents, pleadingText, images.length > 0);
    let result = await requestPerplexity(prompt, images);

    if (!result.ok && images.length) {
      result = await requestPerplexity(
        `${prompt}\n\nA photo was attached, but it could not be sent to search. Answer from the question and the sources above.`,
        [],
      );
    }

    if (!result.ok) {
      const message = result.data?.error?.message || 'Ask Me could not complete this search.';
      return res.status(result.status || 502).json({ success: false, message });
    }

    const parsed = readPerplexityPayload(result.data);
    if (!parsed.content) {
      return res.status(502).json({
        success: false,
        message: 'Ask Me returned an empty answer. Please try the question again.',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        content: parsed.content,
        webSearchUsed: true,
        webSources: parsed.webSources,
        citations: documentCitations(documents),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
