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

function excerpt(text, words, max = 1800) {
  if (!text) return '';
  const lower = text.toLowerCase();
  let index = -1;

  words.forEach((word) => {
    const found = lower.indexOf(word);
    if (found !== -1 && (index === -1 || found < index)) index = found;
  });

  if (index === -1) return text.slice(0, max);
  const start = Math.max(0, index - 300);
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

function detectTaskMode(question, pleadingText) {
  const q = `${question}\n${pleadingText}`.toLowerCase();
  if (/\bdraft\b|\bprepare\b|\bwrite\b|\bplead\b|\bmotion\b|\bcomplaint\b|\baffidavit\b|\bcontract\b|\bagreement\b|\bdeed\b|\bwill\b|\bnotice\b|\bletter\b|\bpetition\b|\banswer\b.*\bdefend|\bresponse\b.*\bsuit|\bsubmission\b/.test(q)) {
    return 'draft';
  }
  if (/\breview\b|\bcheck\b|\bcomment\b|\bedit\b|\bproofread\b|\basses\b|\bassess\b|\bstrength\b|\bweakness\b|\bmerit\b|\bchance\b|\bhow strong\b|\bwill i win|\bdo i have a case\b/.test(q)) {
    return 'review';
  }
  if (/\bexplain\b|\bsimplif\b|\bwhat does .* mean\b|\bmeaning of\b|\blayman|\bsimple terms\b|\bbriefly\b/.test(q)) {
    return 'explain';
  }
  if (/\bcompare\b|\bdifference between\b|\bcontrast\b|\bvs\.?\b|\bversus\b/.test(q)) {
    return 'compare';
  }
  return 'research';
}

function buildPrompt(question, documents, pleadingText, hasImage, mode) {
  const library = documents.length
    ? documents
        .map(
          (document, index) =>
            `DOCUMENT ${index + 1}: ${document.title} (${document.category})\nID: ${document.id}\n---\n${document.excerpt}`,
        )
        .join('\n\n')
    : 'No uploaded LexLiberia document matched this question yet.';

  const pleadingBlock = pleadingText || hasImage
    ? `\n\nATTACHMENT (pleading / document):\n${
        pleadingText
          ? pleadingText.slice(0, 80000)
          : 'The document is in the attached image. Read it carefully.'
      }\n`
    : '';

  const modeBrief =
    mode === 'draft'
      ? '\nTASK MODE: DRAFTING — write a complete, usable Liberian-style legal document (motion / affidavit / contract / letter / response). Structure it with caption, parties, title, body numbered paragraphs, prayer/wherefore, and signature blocks where appropriate. Tailor every fact (names, dates, amounts, claims) to whatever is provided in the question and attachment; use [bracketed placeholders] only where the user truly omitted information and label the placeholders clearly.'
      : mode === 'review'
      ? '\nTASK MODE: DOCUMENT REVIEW — read the attachment and give (1) a 3-bullet Executive Summary; (2) Strengths; (3) Weaknesses / Risks; (4) Recommended Next Steps with Liberian law citations where applicable.'
      : mode === 'explain'
      ? '\nTASK MODE: PLAIN-LANGUAGE EXPLANATION — answer in two layers: first a 2-3 sentence Layman Summary; then a Detailed Legal Explanation with section numbers.'
      : mode === 'compare'
      ? '\nTASK MODE: COMPARISON — present the answer as a structured comparison: Side-by-side table first, then a Recommendation section.'
      : '\nTASK MODE: LEGAL RESEARCH — answer the question thoroughly with Liberian authorities cited.';

  return `USER QUESTION:\n${question}${pleadingBlock}${modeBrief}\n\nRETRIEVED LexLiberia LAWS (quote these first when relevant — use section numbers and block-quote the exact statutory language):\n${library}\n\nOFFICIAL SOURCES TO SEARCH NEXT (before any general web results):\n1. Supreme Court of Liberia opinions — site:judiciary.gov.lr/opinions\n2. LiberLII — site:liberlii.org\n3. The Laws of Liberia Revised / Ministry of Justice gazettes on the web\n\nAfter those, search the wider public web (law review articles, comparative common-law authorities from Ghana, Nigeria, Sierra Leone, UK, and India if Liberian authority is silent, with a clear disclaimer that they are persuasive only).`;
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
    content: cleanAiOutput(parts.join('\n\n').trim()),
    webSources: webSources.filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    }),
  };
}

function cleanAiOutput(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  text = text.replace(/\r\n?/g, '\n');

  text = text.replace(/\[\*\s*[0-9]+\s*\]/g, '');
  text = text.replace(/\[\*\*[0-9]+\*\*\]/g, '');
  text = text.replace(/\(\*\s*[0-9]+\s*\)/g, '');
  text = text.replace(/^\s*\(\*\*[^)]*\*\*\)\s*$/gm, '');
  text = text.replace(/\[search result[^\]]*\]/gi, '');
  text = text.replace(/\[source[^\]]*\]/gi, '');
  text = text.replace(/\[citation[^\]]*\]/gi, '');

  text = text.replace(/\\\*/g, '*');
  text = text.replace(/\\_/g, '_');
  text = text.replace(/\\#/g, '#');
  text = text.replace(/\\-/g, '-');
  text = text.replace(/\\\)/g, ')');
  text = text.replace(/\\\(/g, '(');
  text = text.replace(/\\\[/g, '[');
  text = text.replace(/\\\]/g, ']');
  text = text.replace(/\s+\\\./g, '.');

  text = text.replace(/^[ \t]+(\S)/gm, '$1');

  let prev;
  do {
    prev = text;
    text = text.replace(/\n{3,}/g, '\n\n');
  } while (text !== prev);

  text = text.replace(/\n\s*\*\s*\n/g, '\n\n');

  return text.trim();
}

async function requestOpenAI(prompt, useWebSearch, images = []) {
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  const body = {
    model,
    instructions:
      'You are LexLiberia AI — the advanced, flexible legal research assistant for Liberian lawyers, students, and admins. You can RESEARCH Liberian law, DRAFT full Liberian-style court documents (motions, affidavits, complaints, contracts, letters, wills, notices, petitions, written addresses, and wherefore clauses), REVIEW/comment on an attached pleading, COMPARE two laws or scenarios, or EXPLAIN in plain language. Always honour the TASK MODE requested in the prompt.\n\nSOURCE PRIORITY (strict order; cite with section numbers and exact block-quote passages whenever you find matching text):\n1. LexLiberia uploaded DOCUMENTS (laws and opinions) included in the prompt — these are primary; if a section matches, quote it verbatim in a Markdown blockquote with the statute name + section.\n2. Supreme Court of Liberia opinions — site:judiciary.gov.lr/opinions (use case name + citation + year when you find one).\n3. LiberLII — site:liberlii.org.\n4. Laws of Liberia Revised / Ministry of Justice gazettes / official Liberian Government sites.\n5. Wider web (law reviews, blogs).\n6. If Liberian authority is genuinely silent on a novel point, you MAY cite persuasive common-law precedent from Ghana, Nigeria, Sierra Leone, UK, or India — BUT ADD A CLEAR DISCLOSURE that those are persuasive (not binding) authorities in Liberia, and suggest seeking an opinion of counsel.\n\nIf a source does not contain the text, SAY SO and do not invent citations, section numbers, or quotations. If the attachment contradicts the law, flag the conflict.\n\nFORMATTING RULES (observe exactly, no exceptions):\n- Write in clean, natural prose, NO backslash escapes, NO `(*1*)` or `[*1*]` search markers embedded in the answer text.\n- Use standard Markdown: `##` headings, `###` subheadings, `-` bullets, `1.` numbered lists, `**bold**`, `*italic*`, plain paragraphs.\n- When QUOTING a statute, section, or judgment passage DIRECTLY, use a Markdown `> ` blockquote and label the source (statute name, section, case citation, or URL).\n- Put ALL citations, links, and source references in a single `## Sources` section AT THE END (one source per line). NEVER sprinkle markers like [1], (*1*), [source] inside the body paragraphs.\n- Tables use simple pipes: Header | Header / --- | --- / cell | cell. Do NOT escape pipes inside table cells.\n- If drafting a court document, output the real Liberian-style structure: (a) CAPTION (Court name / parties / suit number), (b) TITLE of document, (c) numbered paragraphs with factual and legal allegations, (d) LAW & ARGUMENT section with Liberian authorities cited per rules above, (e) PRAYER / WHEREFORE CLAUSE, (f) signature block (Name of Counsel / address / date / phone / email). Use [bracketed placeholders] ONLY where the user truly omitted a fact — label each placeholder clearly (e.g. [Full residential address of Claimant]).\n- If doing a DOCUMENT REVIEW, structure output as: (1) Executive Summary (3 bullets); (2) Strengths; (3) Weaknesses/Risks; (4) Recommended Next Steps + Liberian law citations where applicable.\n- If doing an EXPLANATION, answer in two tiers: first a 2–3 sentence **Layman Summary**, then a **Detailed Legal Explanation** with sections cited.\n- If doing a COMPARISON, use a Markdown side-by-side table first, then a **Recommendation** section.\n- Never end with a generic disclaimer. If you must add a caveat, embed it contextually (e.g., "Disclaimer: the Ghanaian authority below is persuasive, not binding in Liberia.").',
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
    max_output_tokens: 16000,
    temperature: 0.25,
    top_p: 0.95,
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
    if (question.length > 10000) {
      return res.status(400).json({ success: false, message: 'Please shorten the question.' });
    }
    if (!canUseAiResearch(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'AI Research is available on the Student plan and above. Subscribe or log in with a paid account to use this tool.',
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
    const mode = detectTaskMode(question, pleadingText);
    const prompt = buildPrompt(question, documents, pleadingText, images.length > 0, mode);
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
  const webSources = [];
  const outputText = String(data?.output_text || '').trim();
  const textParts = outputText ? [outputText] : [];

  for (const item of data?.output || []) {
    if (!outputText && item?.type === 'message') {
      for (const content of item.content || []) {
        if (content?.text) textParts.push(content.text);
      }
    }

    const results = item?.type === 'search_results' ? item.results : [];
    for (const result of results || []) {
      if (result?.url) {
        webSources.push({ title: result.title || result.url, url: result.url });
      }
    }
  }

  if (!textParts.length) {
    const legacy = String(data?.choices?.[0]?.message?.content || '').trim();
    if (legacy) textParts.push(legacy);
  }

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
    content: cleanAiOutput(textParts.join('\n\n').trim()),
    webSources: webSources.filter((source) => {
      if (!source.url || seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    }),
  };
}

function perplexityPreset() {
  const setting = String(process.env.PERPLEXITY_MODEL || 'sonar-pro').trim().toLowerCase();
  const presets = {
    sonar: 'fast',
    'sonar-pro': 'low',
    'sonar-reasoning-pro': 'low',
    'sonar-deep-research': 'low',
    fast: 'fast',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
  };
  return presets[setting] || 'low';
}

async function requestPerplexity(prompt, images = []) {
  const input = images.length
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
    : prompt;

  const response = await fetch('https://api.perplexity.ai/v1/agent', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      preset: perplexityPreset(),
      instructions:
        'You are Ask Me — the advanced, flexible general-purpose research assistant of LexLiberia for paid subscribers and administrators. You can RESEARCH any Liberian legal or public-policy question, DRAFT Liberian-style documents (motions, affidavits, contracts, letters, petitions, written addresses, wherefore clauses), REVIEW an attached pleading, COMPARE options, or EXPLAIN in plain language. Honour the TASK MODE in the prompt.\n\nSOURCE PRIORITY (cite with section/case numbers and use Markdown `> ` blockquote for verbatim quotes):\n1. The LexLiberia DOCUMENTS embedded in the prompt (primary).\n2. Supreme Court of Liberia opinions — site:judiciary.gov.lr/opinions (use case name + citation + year).\n3. LiberLII — site:liberlii.org.\n4. Liberian Government official sites (Laws of Liberia Revised, MOJ gazettes).\n5. Wider web / law reviews.\n6. If Liberian authority is silent, you may cite Ghana / Nigeria / Sierra Leone / UK / India persuasive common-law — BUT ADD AN EXPLICIT DISCLAIMER that those are persuasive (not binding) in Liberia, and recommend counsel opinion.\n\nNever invent citations or quotations. If an authoritative source does not contain the text, SAY SO. If the attachment contradicts the law, flag the conflict.\n\nFORMATTING (no exceptions):\n- Clean, natural prose. No backslash escapes. Never embed `(*1*)`, `[*1*]`, `[source]` or similar markers inside the answer.\n- Standard Markdown: `##` headings, `###` subheadings, `-` bullets, `1.` numbered lists, `**bold**`, `*italic*`, plain paragraphs.\n- Use `> ` blockquote for verbatim statutory or judgment quotes, with a source label.\n- Collect ALL citations/links in ONE `## Sources` section AT THE END (one per line). Never insert markers like [1] inside body paragraphs.\n- Simple Markdown tables; do NOT escape pipes.\n- DRAFTING mode: output a Liberian-style document with CAPTION → TITLE → numbered paragraphs → LAW & ARGUMENT (with Liberian cites) → PRAYER/WHEREFORE → signature block (Counsel name / address / date / phone / email). Use labelled [placeholders] only where the user omitted a fact.\n- REVIEW mode: Executive Summary (3 bullets) → Strengths → Weaknesses/Risks → Recommended Next Steps.\n- EXPLAIN mode: Layman Summary (2–3 sentences) → Detailed Legal Explanation with sections cited.\n- COMPARE mode: side-by-side table → Recommendation section.\n- No generic end-of-answer disclaimers. Add caveats contextually when needed.',
      input,
      max_output_tokens: 12000,
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
    if (question.length > 10000) {
      return res.status(400).json({ success: false, message: 'Please shorten the question.' });
    }
    if (!canUseAiResearch(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Ask Me is available on the Student plan and above. Subscribe or log in with a paid account to use this tool.',
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
    const mode = detectTaskMode(question, pleadingText);
    const prompt = buildPrompt(question, documents, pleadingText, images.length > 0, mode);
    let result = await requestPerplexity(prompt, images);

    if (!result.ok && images.length) {
      result = await requestPerplexity(
        `${prompt}\n\nA photo was attached, but it could not be sent to search. Answer from the question and the sources above.`,
        [],
      );
    }

    if (!result.ok) {
      const apiError = result.data?.error;
      const message = (typeof apiError === 'string' ? apiError : apiError?.message)
        || result.data?.message
        || 'Ask Me could not complete this search.';
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
