import { expect, it } from 'vitest';
import { sourceTextMap, sourceRange } from '../src/content/sourceHighlighter';
import { cleanMessageText, contentOf } from '../src/content/chatgpt/extractor';
it('maps repeated sentences and cross-block formatted selections without changing the page DOM', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<p>Same sentence.</p><p>Same <strong>sentence.</strong></p><ul><li>Third sentence.</li></ul><button>Copy</button>';
  document.body.append(root);
  const before = root.innerHTML;
  const text = cleanMessageText(root);
  const map = sourceTextMap(root, text);
  const start = text.lastIndexOf('Same');
  const range = sourceRange(map, start, text.length)!;
  expect(range.startContainer).toBe(root.querySelectorAll('p')[1]?.firstChild);
  expect(range.toString()).toBe('Same sentence.Third sentence.');
  expect(root.innerHTML).toBe(before);
  expect(map.some((char) => char.node.parentElement?.tagName === 'BUTTON')).toBe(false);
  root.remove();
});

it('maps the end of an answer even when only the opening section has a known content class', () => {
  const answer = document.createElement('article');
  answer.innerHTML =
    '<h5 class="sr-only">ChatGPT said:</h5><div class="markdown"><p>Opening section.</p></div><section><h2>Later section</h2><p>Highlight this final sentence.</p></section><button>Copy</button>';
  document.body.append(answer);
  const root = contentOf(answer);
  const text = cleanMessageText(root);
  expect(text).toContain('Highlight this final sentence.');
  const quote = 'Highlight this final sentence.';
  const start = text.indexOf(quote);
  expect(sourceRange(sourceTextMap(root, text), start, start + quote.length)?.toString()).toBe(
    quote,
  );
  expect(text).not.toContain('Copy');
  answer.remove();
});
