// Fails when one module file is imported under more than one URL.
//
// Browsers and Node key ES modules by their full URL, so `x.js?v=a` and
// `x.js?v=b` evaluate as two separate instances: module-level state such as a
// runtime, broker or status store silently exists twice. Scans src/**/*.js and
// the HTML entry points; relative static imports, re-exports and literal
// dynamic imports are compared after resolving them against their importer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const htmlEntries = ['index.html', 'earth-eonet-relief.html', 'living-protein.html'];
const NO_QUERY = '(no query)';

// Tokens that can directly precede a regular expression literal; after any
// other word, number or closing bracket a slash is a division operator.
const WORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

function isIdentifierChar(char) {
  return /[\w$]/.test(char) || char > '\x7f';
}

// Minimal JavaScript tokenizer. Comments disappear and template literals
// become opaque, so import-like text inside comments or shader strings is
// never mistaken for an import. Throws on unterminated constructs so the gate
// fails closed rather than silently skipping the remainder of a file.
function tokenize(source) {
  const tokens = [];
  const templateDepths = [];
  let index = 0;
  let line = 1;

  const push = (type, value, tokenLine = line) => tokens.push({ type, value, line: tokenLine });

  function readTemplateChars() {
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        if (source[index + 1] === '\n') line += 1;
        index += 2;
      } else if (char === '`') {
        index += 1;
        push('template', '');
        return;
      } else if (char === '$' && source[index + 1] === '{') {
        index += 2;
        templateDepths.push(0);
        return;
      } else {
        if (char === '\n') line += 1;
        index += 1;
      }
    }
    throw new Error(`unterminated template literal near line ${line}`);
  }

  function readString(quote) {
    const startLine = line;
    let value = '';
    index += 1;
    while (index < source.length) {
      const char = source[index];
      if (char === quote) {
        index += 1;
        push('string', value, startLine);
        return;
      }
      if (char === '\n') break;
      if (char === '\\') {
        if (source[index + 1] === '\n') line += 1;
        value += source.slice(index, index + 2);
        index += 2;
      } else {
        value += char;
        index += 1;
      }
    }
    throw new Error(`unterminated string near line ${startLine}`);
  }

  function regexAllowed() {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    if (previous.type === 'word') return WORDS_BEFORE_REGEX.has(previous.value);
    if (previous.type !== 'punct') return false;
    return ![')', ']', '}'].includes(previous.value);
  }

  // Returns false when no closing slash exists on the line, in which case the
  // slash is treated as an ordinary operator.
  function tryReadRegex() {
    let cursor = index + 1;
    let inClass = false;
    while (cursor < source.length && source[cursor] !== '\n') {
      const char = source[cursor];
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        cursor += 1;
        while (cursor < source.length && isIdentifierChar(source[cursor])) cursor += 1;
        index = cursor;
        push('regex', '');
        return true;
      }
      cursor += 1;
    }
    return false;
  }

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '\n') {
      line += 1;
      index += 1;
    } else if (/\s/.test(char)) {
      index += 1;
    } else if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new Error(`unterminated block comment near line ${line}`);
      for (let cursor = index; cursor < end; cursor += 1) {
        if (source[cursor] === '\n') line += 1;
      }
      index = end + 2;
    } else if (char === '\'' || char === '"') {
      readString(char);
    } else if (char === '`') {
      index += 1;
      readTemplateChars();
    } else if (char === '/' && regexAllowed() && tryReadRegex()) {
      // tryReadRegex already consumed the literal.
    } else if (isIdentifierChar(char)) {
      const start = index;
      while (index < source.length && isIdentifierChar(source[index])) index += 1;
      push('word', source.slice(start, index));
    } else if (templateDepths.length && char === '}' && templateDepths[templateDepths.length - 1] === 0) {
      templateDepths.pop();
      index += 1;
      readTemplateChars();
    } else {
      if (templateDepths.length && char === '{') templateDepths[templateDepths.length - 1] += 1;
      if (templateDepths.length && char === '}') templateDepths[templateDepths.length - 1] -= 1;
      push('punct', char);
      index += 1;
    }
  }
  if (templateDepths.length) throw new Error('unterminated template expression at end of input');
  return tokens;
}

// Returns literal module specifiers and the count of computed import() calls,
// which cannot be resolved statically.
function collectSpecifiers(source, lineOffset = 0) {
  const tokens = tokenize(source);
  const specifiers = [];
  let computedDynamicImports = 0;
  const add = (token) => specifiers.push({ specifier: token.value, line: token.line + lineOffset });

  tokens.forEach((token, position) => {
    if (token.type !== 'word') return;
    const previous = tokens[position - 1];
    if (previous?.type === 'punct' && previous.value === '.') return;
    const next = tokens[position + 1];
    if (token.value === 'from' && next?.type === 'string') {
      add(next);
    } else if (token.value === 'import' && next?.type === 'string') {
      add(next);
    } else if (token.value === 'import' && next?.type === 'punct' && next.value === '(') {
      const argument = tokens[position + 2];
      const afterArgument = tokens[position + 3];
      const isLiteral = argument?.type === 'string'
        && afterArgument?.type === 'punct'
        && [')', ','].includes(afterArgument.value);
      if (isLiteral) add(argument);
      else computedDynamicImports += 1;
    }
  });
  return { specifiers, computedDynamicImports };
}

function readAttribute(attributes, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function collectFromHtml(html) {
  const specifiers = [];
  let computedDynamicImports = 0;
  const elements = /<!--[\s\S]*?-->|<link\b([^>]*)>|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const lineAt = (offset) => html.slice(0, offset).split('\n').length;

  for (const match of html.matchAll(elements)) {
    const [element, linkAttributes, scriptAttributes, scriptBody] = match;
    if (element.startsWith('<!--')) continue;
    if (linkAttributes !== undefined) {
      if (readAttribute(linkAttributes, 'rel')?.toLowerCase() === 'modulepreload') {
        specifiers.push({ specifier: readAttribute(linkAttributes, 'href'), line: lineAt(match.index) });
      }
      continue;
    }
    if (readAttribute(scriptAttributes, 'type')?.toLowerCase() !== 'module') continue;
    const src = readAttribute(scriptAttributes, 'src');
    if (src !== null) {
      specifiers.push({ specifier: src, line: lineAt(match.index) });
      continue;
    }
    const bodyOffset = match.index + element.indexOf('>') + 1;
    const inline = collectSpecifiers(scriptBody, lineAt(bodyOffset) - 1);
    specifiers.push(...inline.specifiers);
    computedDynamicImports += inline.computedDynamicImports;
  }
  return { specifiers, computedDynamicImports };
}

async function listJavaScript(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScript(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  }));
  return nested.flat();
}

function repositoryPath(absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

const files = [
  ...await listJavaScript(path.join(root, 'src')),
  ...htmlEntries.map((file) => path.join(root, file)),
];

// resolved module -> query variant -> importer locations
const modules = new Map();
const failures = [];
let relativeImports = 0;
let computedDynamicImports = 0;

for (const file of files) {
  const label = repositoryPath(file);
  let found;
  try {
    const source = await fs.readFile(file, 'utf8');
    found = file.endsWith('.html') ? collectFromHtml(source) : collectSpecifiers(source);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    continue;
  }
  computedDynamicImports += found.computedDynamicImports;
  for (const { specifier, line } of found.specifiers) {
    if (!/^\.{1,2}\//.test(specifier)) continue;
    relativeImports += 1;
    const [, modulePath, query] = /^([^?#]*)(.*)$/.exec(specifier);
    const resolved = repositoryPath(path.resolve(path.dirname(file), modulePath));
    if (!modules.has(resolved)) modules.set(resolved, new Map());
    const variants = modules.get(resolved);
    const variant = query || NO_QUERY;
    if (!variants.has(variant)) variants.set(variant, []);
    variants.get(variant).push(`${label}:${line}`);
  }
}

const duplicated = [...modules.entries()]
  .filter(([, variants]) => variants.size > 1)
  .sort(([left], [right]) => left.localeCompare(right));

for (const [modulePath, variants] of duplicated) {
  console.error(`${modulePath} (${variants.size} URLs)`);
  for (const [variant, importers] of variants) {
    console.error(`  ${variant}`);
    importers.forEach((importer) => console.error(`    ${importer}`));
  }
}
failures.forEach((failure) => console.error(`cannot scan ${failure}`));

console.log(`import urls files=${files.length} relative imports=${relativeImports} modules=${modules.size} computed dynamic imports skipped=${computedDynamicImports} modules with multiple URLs=${duplicated.length} scan failures=${failures.length}`);
process.exitCode = duplicated.length || failures.length ? 1 : 0;
