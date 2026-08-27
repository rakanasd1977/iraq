import { Spinner as SharedSpinner } from '@rafidain/shared/ui';

export const Spinner = SharedSpinner;

export function CenterSpinner() {
  return (
    <div className="center" style={{ padding: 48 }}>
      <SharedSpinner />
    </div>
  );
}
