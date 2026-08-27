import { createAuth } from '@rafidain/shared/auth';
import { api } from './api';
import { push } from './push';

export const { AuthProvider, useAuth } = createAuth({
  role: 'agent',
  api,
  push,
});
