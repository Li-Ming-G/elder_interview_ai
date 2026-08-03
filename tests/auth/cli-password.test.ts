import { describe, expect, it, vi } from 'vitest';

import { readConfirmedPassword } from '../../apps/api/src/cli/user-cli.js';

describe('controlled user CLI password input', () => {
  it('reads password twice from an injected interactive reader', async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce('Fictional-Password-42!')
      .mockResolvedValueOnce('Fictional-Password-42!');
    await expect(readConfirmedPassword(reader)).resolves.toBe('Fictional-Password-42!');
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('rejects mismatched confirmation', async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce('Fictional-Password-42!')
      .mockResolvedValueOnce('Different-Password-42!');
    await expect(readConfirmedPassword(reader)).rejects.toThrow(/confirmation/);
  });
});
