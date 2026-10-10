import hljs from 'highlight.js/lib/core';
import php from 'highlight.js/lib/languages/php';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import ini from 'highlight.js/lib/languages/ini';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('php', php);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);

const EXT_LANGUAGE: Record<string, string> = {
  php: 'php',
  phtml: 'php',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  json: 'json',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'css',
  sh: 'bash',
  bash: 'bash',
  ini: 'ini',
  conf: 'ini',
  env: 'ini',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
};

export const languageForFile = (fileName: string): string => {
  const base = (fileName.split('/').pop() || fileName).toLowerCase();
  if (base.startsWith('.env')) return 'ini';
  const ext = base.includes('.') ? base.split('.').pop() || '' : '';
  return EXT_LANGUAGE[ext] || 'plaintext';
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

export const highlightCode = (code: string, fileName: string): string => {
  const language = languageForFile(fileName);
  try {
    if (language !== 'plaintext' && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
  } catch {
    /* fall through to plain escape */
  }
  return escapeHtml(code);
};
