import { expect, it } from 'vitest';
import { sourceTextMap, sourceRange } from '../src/content/sourceHighlighter';
import { cleanMessageText } from '../src/content/chatgpt/extractor';
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
