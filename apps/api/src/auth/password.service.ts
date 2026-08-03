import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  public async hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON_OPTIONS);
  }

  public async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
