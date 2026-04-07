import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOperatorAuthSession } from '../public/operator-auth-session.js';

class FakeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('operator auth session', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('stores the pending email when requesting an OTP code', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const session = createOperatorAuthSession({
      enabled: true,
      redirectUrl: 'http://10.1.2.158:3000',
      storage,
      supabase: {
        auth: {
          signInWithOtp
        }
      }
    });

    await session.requestEmailOtp('person@example.com');

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'person@example.com'
    });
    expect(session.getPendingEmail()).toBe('person@example.com');
  });

  it('verifies an email OTP and clears the pending email once a session is established', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: {
            id: 'user-1',
            email: 'person@example.com'
          }
        }
      },
      error: null
    });

    const session = createOperatorAuthSession({
      enabled: true,
      redirectUrl: 'http://10.1.2.158:3000',
      storage,
      supabase: {
        auth: {
          verifyOtp
        }
      }
    });

    storage.setItem('operator-auth-pending-email', 'person@example.com');
    const user = await session.verifyEmailOtp('123456');

    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: '123456',
      type: 'email'
    });
    expect(user?.email).toBe('person@example.com');
    expect(session.getPendingEmail()).toBeNull();
  });

  it('reads the current signed-in user from the persisted session', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'person@example.com'
          }
        }
      }
    });

    const session = createOperatorAuthSession({
      enabled: true,
      redirectUrl: 'http://10.1.2.158:3000',
      storage,
      supabase: {
        auth: {
          getSession
        }
      }
    });

    const user = await session.getCurrentUser();

    expect(user?.id).toBe('user-1');
    expect(user?.email).toBe('person@example.com');
  });
});
