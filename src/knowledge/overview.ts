import type { Message, Notebook, NotebookOverview } from '../types';
const stop = new Set(
  (
    'the a an and or to of in is are was were for from with this that it as be by on at can you your how what why which do does explain please about into through use uses using we our they their have has will not more data answer question ' +
    'از به با در و که این آن را برای است هستند یک می یا چه چگونه شما ما دارد شود کنید شود'
  ).split(' '),
);
export function contentSignature(messages: Message[]): string {
  let hash = 2166136261;
  for (const message of messages) {
    const value = `${message.id}:${message.role}:${message.text}`;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return `${messages.length}:${hash >>> 0}`;
}
const tokens = (text: string) =>
  (text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\u200c-]{2,}/gu) ?? []).filter(
    (word) => !stop.has(word) && !/^\d+$/.test(word),
  );
// A source-derived topic index; summary writing remains explicitly user-owned.
export function localOverview(messages: Message[], title = ''): NotebookOverview {
  const passages = messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) =>
      m.text
        .slice(0, 12000)
        .split(/(?<=[.!?؟])\s+|\n+/u)
        .map((text) => ({ text: text.trim(), messageId: m.id }))
        .filter(
          (s) =>
            s.text.length > 35 &&
            s.text.length < 600 &&
            !/^(```|const |import |function |SELECT )/.test(s.text),
        ),
    )
    .slice(0, 240);
  const frequencies = new Map<string, number>();
  for (const passage of passages)
    for (const word of new Set(tokens(passage.text)))
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  const titleWords = tokens(title);
  const topics = [
    ...new Set([
      ...titleWords,
      ...[...frequencies].sort((a, b) => b[1] - a[1]).map(([word]) => word),
    ]),
  ]
    .slice(0, 5)
    .map(
      (word) =>
        title
          .match(/[\p{L}\p{N}][\p{L}\p{N}\u200c-]{2,}/gu)
          ?.find((original) => original.toLocaleLowerCase() === word) ??
        word.replace(/^./u, (char) => char.toUpperCase()),
    );
  return {
    summary: '',
    topics,
    keyInsights: [],
    kind: 'local',
    generatedAt: new Date().toISOString(),
    sourceSignature: contentSignature(messages),
  };
}
export function overviewOf(notebook: Notebook): NotebookOverview {
  const signature = contentSignature(notebook.messages);
  const overview =
    notebook.overview?.sourceSignature === signature || notebook.overview?.kind === 'manual'
      ? notebook.overview
      : localOverview(notebook.messages, notebook.title);
  return {
    ...overview,
    topics: [
      ...new Set([...notebook.highlights.flatMap((h) => h.tags ?? []), ...overview.topics]),
    ].slice(0, 8),
    keyInsights: [...notebook.highlights]
      .sort(
        (a, b) =>
          Number(!!b.bookmarked) - Number(!!a.bookmarked) ||
          (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )
      .slice(0, 4)
      .map(({ text, messageId }) => ({ text, messageId })),
  };
}
