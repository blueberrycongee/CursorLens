import { describe, expect, it } from 'vitest';
import { buildSubtitleLines } from './subtitleLayout';

describe('subtitleLayout', () => {
  it('keeps short text in one line', () => {
    expect(buildSubtitleLines('hello world', 20, 2)).toEqual(['hello world']);
  });

  it('wraps by words for latin text', () => {
    expect(buildSubtitleLines('this is a subtitle example', 10, 2)).toEqual([
      'this is a',
      'subtitle…',
    ]);
  });

  it('wraps by grapheme for cjk text', () => {
    expect(buildSubtitleLines('这是一个用于测试自动换行的字幕样例', 8, 2)).toEqual([
      '这是一个用于测试',
      '自动换行的字幕…',
    ]);
  });
});
