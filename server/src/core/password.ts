import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Compare against a throwaway hash so timing doesn't reveal account existence. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.6uIfIXLYcCivRiCLHiC66vU0CLoHnSS';
export function verifyDummyPassword(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, DUMMY_HASH);
}
