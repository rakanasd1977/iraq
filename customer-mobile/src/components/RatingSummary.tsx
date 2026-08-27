import { RatingStars } from './RatingStars';

// ملخص تقييمات بأسلوب علي إكسبريس: رقم كبير + شريط تفصيل النجوم (5/4/3/2/1) بأعداد ونِسَب.
export function RatingSummary({ rating = 0, count = 0, breakdown }: any) {
  const total = Number(count) || 0;
  const rows = [5, 4, 3, 2, 1].map((n) => {
    const b = (breakdown || []).find((x: any) => Number(x.rating) === n);
    return { n, count: b ? Number(b.count) : 0 };
  });
  const pct = (c: number) => (total > 0 ? Math.round((c / total) * 100) : 0);

  if (!total) return null;

  return (
    <div className="rsummary">
      <div className="rsummary__score">
        <div className="rsummary__num">{Number(rating || 0).toFixed(1)}</div>
        <div className="rsummary__stars">
          <RatingStars rating={rating} count={count} />
        </div>
        <div className="rsummary__count">{total} تقييم</div>
      </div>
      <div className="rsummary__bars">
        {rows.map((r) => (
          <div className="rsummary__row" key={r.n}>
            <span className="rsummary__label">{r.n}★</span>
            <span className="rating-bar">
              <span className="rating-bar__fill" style={{ width: `${pct(r.count)}%` }} />
            </span>
            <span className="rsummary__val">{pct(r.count)}%</span>
            <span className="rsummary__num2">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
