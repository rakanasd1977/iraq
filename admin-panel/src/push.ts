import { api } from './api';
import { createPanelPush } from '@rafidain/shared/default-push';

export const push = createPanelPush(api);
export const { pushSupported, registerSW, enablePush, disablePush } = push;
