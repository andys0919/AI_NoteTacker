import type { AuthenticatedUser } from '../domain/authenticated-user.js';
import type { AuthenticatedUserRepository } from '../domain/authenticated-user-repository.js';

const now = (): string => new Date().toISOString();

export class InMemoryAuthenticatedUserRepository implements AuthenticatedUserRepository {
  private readonly users = new Map<string, AuthenticatedUser>();

  async upsert(user: { id: string; email: string }): Promise<AuthenticatedUser> {
    const existing = this.users.get(user.id);
    const saved = {
      id: user.id,
      email: user.email,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now()
    };

    this.users.set(user.id, saved);
    return saved;
  }

  async getById(id: string): Promise<AuthenticatedUser | undefined> {
    return this.users.get(id);
  }
}
