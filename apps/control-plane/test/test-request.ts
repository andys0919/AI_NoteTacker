import request from 'supertest';
import { beforeEach, vi } from 'vitest';

export const TEST_INTERNAL_SERVICE_TOKEN = 'test-only-internal-service-token';
export const TEST_ADMIN_CONSOLE_PASSWORD = 'test-only-admin-console-password';

beforeEach(() => {
  vi.stubEnv('INTERNAL_SERVICE_TOKEN', TEST_INTERNAL_SERVICE_TOKEN);
  vi.stubEnv('ADMIN_CONSOLE_PASSWORD', TEST_ADMIN_CONSOLE_PASSWORD);
});

const authenticatedRequest = (app: Parameters<typeof request>[0]) =>
  request.agent(app).set('x-internal-service-token', TEST_INTERNAL_SERVICE_TOKEN);

export { request as unauthenticatedRequest };
export default authenticatedRequest;
