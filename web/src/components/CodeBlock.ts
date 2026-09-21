import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { lowlight } from '../highlight';

/**
 * 代码块扩展：
 * - 输入时 lowlight 通过 ProseMirror decoration 实时高亮（所见即所得，而非 md 源码）
 * - 基类序列化时会在 <code> 上输出 language-xxx 类：
 *   既随消息 HTML 持久化语言，又供 CSS 的 :has() 在代码块角落显示语言标签
 */
export const CodeBlock = CodeBlockLowlight.configure({ lowlight });

/** 语言选择器中提供的语言 */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'plaintext', label: '纯文本' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'css', label: 'CSS' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
];
