import { createPush } from '@rafidain/shared/push';
import { api } from './api';

const push = createPush({ api, swUrl: '/sw.js', unwrap: true });

export const { enablePush, disablePush } = push;
