import * as Crypto from 'expo-crypto';

export { childId } from './child-id';

export const newId = (): string => Crypto.randomUUID();

/** 邀請碼：好念、不含容易看錯的字元（沒有 0/O/1/I） */
export function newInviteCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = Crypto.getRandomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
