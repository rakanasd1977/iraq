import { createPush } from './push';

// ينشئ مدير إشعارات Web Push لكل لوحة استناداً إلى عميلها.
// يوحّد الاستدعاء المتكرر في اللوحات (swUrl ثابت + خيارات اختيارية).
export function createPanelPush(api: any, opts: Record<string, any> = {}): any {
  return createPush({ api, swUrl: '/sw.js', ...opts });
}
