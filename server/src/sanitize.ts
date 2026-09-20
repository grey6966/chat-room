import sanitizeHtml from 'sanitize-html';

/**
 * 服务端富文本白名单净化：所有聊天内容落库前必须经过此处，
 * 防止存储型 XSS。前端展示时还会再用 DOMPurify 净化一次（纵深防御）。
 */
export function sanitizeContent(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
      'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote',
      'a', 'code', 'pre', 'span', 'img',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'class'],
      img: ['src', 'alt', 'title', 'class'],
      code: ['class'],
      pre: ['class'],
      span: ['class'],
    },
    allowedSchemesByTag: {
      a: ['http', 'https', 'mailto'],
      // 仅允许相对路径（/uploads/...），禁止 data:/javascript: 等
      img: [],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
    },
  });
}

/** 判断净化后的内容是否为空（纯空白 / 无实质内容） */
export function isContentEmpty(html: string): boolean {
  const text = html
    .replace(/<img\b[^>]*>/gi, ' ') // 图片算有效内容
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length === 0;
}
