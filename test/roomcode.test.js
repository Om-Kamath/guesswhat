import { describe, it, expect } from 'vitest';
import { generateRoomCode, isValidRoomCode, ROOM_CODE_ALPHABET } from '../src/roomcode.js';

describe('generateRoomCode', () => {
  it('returns 5 characters', () => {
    expect(generateRoomCode()).toHaveLength(5);
  });

  it('uses only alphabet characters', () => {
    for (let i = 0; i < 200; i++) {
      for (const ch of generateRoomCode()) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it('excludes ambiguous characters', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[O0I1L]/);
  });
});

describe('isValidRoomCode', () => {
  it('accepts a well-formed code', () => {
    expect(isValidRoomCode('ABCDE')).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isValidRoomCode('ABCD')).toBe(false);
    expect(isValidRoomCode('ABCDEF')).toBe(false);
  });

  it('rejects out-of-alphabet characters', () => {
    expect(isValidRoomCode('ABCD0')).toBe(false);
    expect(isValidRoomCode('abcde')).toBe(false);
  });
});
