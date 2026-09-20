import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
// Lightweight bundling: register only the most common languages.
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import cpp from 'highlight.js/lib/languages/cpp';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);

const md = new MarkdownIt({
  html: false, // raw HTML is escaped; only sanitized Markdown renders
  linkify: true,
  breaks: true,
  highlight(code, language): string {
    const lang = hljs.getLanguage(language) ? language : '';
    const html = lang
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value;
    const label = language || 'text';
    return (
      `<div class="code-block-wrap"><div class="code-head">` +
      `<span class="code-lang">${md.utils.escapeHtml(label)}</span>` +
      `<button type="button" class="copy-code">复制</button></div>` +
      `<pre class="code-block"><code class="hljs language-${md.utils.escapeHtml(label)}">${html}</code></pre></div>`
    );
  },
});

// All links open safely in a new tab.
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const SANITIZE_TAGS = [
  'a', 'b', 'blockquote', 'br', 'button', 'code', 'del', 'div', 'em',
  'h1', 'h2', 'h3', 'h4', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre',
  'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
];

/**
 * Render untrusted Markdown to sanitized HTML.
 *
 * @param source Markdown text
 * @param forPreview relaxes the URI allowlist so a half-typed image/link URL
 *                   (e.g. `![](|)` while the user is still typing) doesn't
 *                   blank the whole composer preview.
 */
export function renderMarkdown(source: string, forPreview = false): string {
  const rawHtml = md.render(source);
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: SANITIZE_TAGS,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'type'],
    ...(forPreview
      ? { ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|data|blob):|\/|#)/i }
      : { ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp):|\/|#)/i }),
  });
}
