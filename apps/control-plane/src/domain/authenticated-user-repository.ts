import type { AuthenticatedUser } from './authenticated-user.js';

export interface AuthenticatedUserRepository {
  upsert(user: { id: string; email: string }): Promise<AuthenticatedUser>;
  getById(id: string): Promise<AuthenticatedUser | undefined>;
}
