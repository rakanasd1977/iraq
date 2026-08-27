export function Stepper({ quantity, onChange, max = 99 }: { quantity: number; onChange: (n: number) => void; max?: number }) {
  const dec = () => onChange(quantity - 1);
  const inc = () => onChange(max && quantity >= max ? quantity : quantity + 1);
  return (
    <div className="stepper">
      <button onClick={dec} type="button" aria-label="إنقاص">−</button>
      <span>{quantity}</span>
      <button onClick={inc} type="button" aria-label="زيادة">+</button>
    </div>
  );
}
