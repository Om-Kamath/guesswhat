export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export function generateRoomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    out += ROOM_CODE_ALPHABET[idx];
  }
  return out;
}

export function isValidRoomCode(s) {
  if (typeof s !== 'string' || s.length !== CODE_LENGTH) return false;
  for (const ch of s) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}
