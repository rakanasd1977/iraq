import { memo, useEffect, useState } from 'react';
import { DealCard } from './DealCard';
import { SectionHead } from './SectionHead';

const pad = (n: number) => String(n).padStart(2, '0');

// نسبة "باقي من الكمية" محسوبة بشكل ثابت من معرّف العنصر لتبدو واقعية دون بيانات مخزون فعلية.
const remainingOf = (itemId: number | string) => 8 + ((Number(itemId) || 0) * 37) % 80;

// عدّاد مستقل يدير حالته بنفسه حتى لا يُعاد رسم قسم العروض كل ثانية.
function Countdown() {
  const [left, setLeft] = useState('00:00:00');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(24, 0, 0, 0);
      const diff = Math.max(0, end.getTime() - now.getTime());
      setLeft(`${pad(Math.floor(diff / 3600000))}:${pad(Math.floor((diff % 3600000) / 60000))}:${pad(Math.floor((diff % 60000) / 1000))}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="countdown" dir="ltr">{left}</span>;
}

export const FlashDeals = memo(function FlashDeals({ deals = [], moreTo = '' }: { deals?: any[]; moreTo?: string }) {
  if (!deals || deals.length === 0) return null;
  return (
    <section className="home-block">
      <SectionHead
        icon="⚡"
        title="عروض اليوم"
        badge={<Countdown />}
        moreTo={moreTo}
      />
      <div className="hscroll">
        {deals.map((d) => <DealCard key={`${d.kind}-${d.item_id}`} deal={d} stock={remainingOf(d.item_id)} />)}
      </div>
    </section>
  );
});
