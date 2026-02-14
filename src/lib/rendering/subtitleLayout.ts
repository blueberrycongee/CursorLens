function countChars(value: string): number {
  return Array.from(value).length;
}

function trimToChars(value: string, maxChars: number): string {
  return Array.from(value).slice(0, Math.max(0, maxChars)).join('');
}

function withEllipsis(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (maxChars === 1) return '…';
  const trimmed = trimToChars(value, maxChars - 1).trim();
  return `${trimmed}…`;
}

function tokenize(text: string): { tokens: string[]; separator: string } {
  if (/\s/.test(text)) {
    return {
      tokens: text.split(/\s+/).filter(Boolean),
      separator: ' ',
    };
  }

  return {
    tokens: Array.from(text),
    separator: '',
  };
}

export function buildSubtitleLines(
  inputText: string,
  maxCharsPerLine: number,
  maxLines: number,
): string[] {
  const text = String(inputText ?? '').trim().replace(/\s+/g, ' ');
  const safeMaxCharsPerLine = Math.max(1, Math.round(maxCharsPerLine));
  const safeMaxLines = Math.max(1, Math.round(maxLines));

  if (!text) return [];
  if (countChars(text) <= safeMaxCharsPerLine) return [text];

  const { tokens, separator } = tokenize(text);
  const lines: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    let line = token;

    if (countChars(line) > safeMaxCharsPerLine) {
      line = trimToChars(line, safeMaxCharsPerLine);
    }

    index += 1;

    while (index < tokens.length) {
      const candidate = `${line}${separator}${tokens[index]}`.trim();
      if (countChars(candidate) > safeMaxCharsPerLine) {
        break;
      }
      line = candidate;
      index += 1;
    }

    const hasMore = index < tokens.length;
    const isLastLine = lines.length === safeMaxLines - 1;

    if (hasMore && isLastLine) {
      lines.push(withEllipsis(line, safeMaxCharsPerLine));
      return lines;
    }

    lines.push(line);

    if (lines.length >= safeMaxLines) {
      return lines;
    }
  }

  return lines;
}
