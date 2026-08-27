const OPTS = [1, 2, 3, 4, 5];

// خيارات الكمية كبطاقات كبيرة قابلة للمس (نمط علي إكسبريس).
export function QtyPicker({ value, onChange, max = 99 }: { value: number; onChange: (n: number) => void; max?: number }) {
  const cap = typeof max === 'number' && max > 0 ? Math.min(max, 5) : 5;
  return (
    <div className="qtypick">
      {OPTS.slice(0, cap).map((n) => (
        <button
          key={n}
          type="button"
          className={`qtypick__opt${value === n ? ' qtypick__opt--on' : ''}`}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
