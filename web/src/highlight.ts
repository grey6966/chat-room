import { createLowlight } from 'lowlight';
import { toHtml } from 'hast-util-to-html';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import markdownLang from 'highlight.js/lib/languages/markdown';

/** 仅注册常用语言，供编辑器与消息渲染共用，避免打包全量语言包 */
export const lowlight: ReturnType<typeof createLowlight> = createLowlight();
lowlight.register({
  javascript,
  typescript,
  python,
  java,
  go,
  rust,
  c,
  cpp,
  sql,
  bash,
  json,
  xml,
  css,
  yaml,
  markdown: markdownLang,
});

/** 别名：编辑器/用户可能写成 js、ts、jsx 等 */
lowlight.registerAlias({
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  typescript: ['ts', 'tsx'],
  python: ['py'],
  shell: ['sh'],
  bash: ['shell'],
  xml: ['html'],
  markdown: ['md'],
});

/**
 * 对渲染后的 <code> 块就地高亮。
 * TipTap 代码块输出 <pre><code class="language-xxx">，识别不到语言时保持原文。
 */
export function highlightCodeElement(el: HTMLElement): void {
  if (el.classList.contains('hljs')) return;
  const langClass = [...el.classList].find((c) => c.startsWith('language-'));
  const lang = langClass?.slice('language-'.length);
  const code = el.textContent ?? '';
  try {
    const tree =
      lang && lowlight.registered(lang)
        ? lowlight.highlight(lang, code)
        : lowlight.highlightAuto(code);
    el.innerHTML = toHtml(tree.children);
    el.classList.add('hljs');
    if (lang) el.classList.add(`language-${lang}`);
  } catch {
    /* 高亮失败保持原文 */
  }
}
