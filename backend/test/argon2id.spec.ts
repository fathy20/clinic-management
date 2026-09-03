import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { verify } from '@node-rs/argon2';

/**
 * `@node-rs/argon2` exports `Algorithm` as an ambient const enum, which
 * `isolatedModules` cannot read, so the variant is inlined as a number. This test
 * checks the constant against reality rather than trusting it — a silent switch to
 * Argon2i or Argon2d would otherwise be invisible.
 */
describe('password hashing (FR-IAM-01, NFR-SEC-04)', () => {
  it('produces an Argon2id hash', async () => {
    const hashed = await AuthService.hashPassword(
      'correct horse battery staple',
    );
    expect(hashed.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hashed = await AuthService.hashPassword(
      'correct horse battery staple',
    );
    await expect(verify(hashed, 'correct horse battery staple')).resolves.toBe(
      true,
    );
    await expect(verify(hashed, 'Correct horse battery staple')).resolves.toBe(
      false,
    );
  });

  it('salts: the same password hashes differently every time', async () => {
    const [one, two] = await Promise.all([
      AuthService.hashPassword('same password'),
      AuthService.hashPassword('same password'),
    ]);
    expect(one).not.toBe(two);
  });
});
