import { useEffect, useRef, useState } from 'react';
import { AdCard } from './AdCard';
import type { ApiRecord } from '../types';

export function AdCarousel({ ads, interval = 4500, variant }: { ads: ApiRecord[]; interval?: number; variant?: string }) {
  const count = ads.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    if (paused || count <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), interval);
    return () => clearInterval(t);
  }, [paused, count, interval]);

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [index, count]);

  if (count === 0) return null;

  if (count === 1) {
    return (
      <div className="ad-carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="ad-carousel__slide"><AdCard ad={ads[0]} variant={variant} /></div>
      </div>
    );
  }

  const go = (i: number) => setIndex(((i % count) + count) % count);

  return (
    <div
      className="ad-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) {
          if (dx > 0) go(index - 1);
          else go(index + 1);
        }
        touchX.current = null;
      }}
    >
      <div className="ad-carousel__track" style={{ transform: `translateX(${index * 100}%)` }}>
        {ads.map((ad) => (
          <div className="ad-carousel__slide" key={ad.id}>
            <AdCard ad={ad} variant={variant} />
          </div>
        ))}
      </div>
      <button className="ad-carousel__arrow ad-carousel__arrow--next" onClick={() => go(index + 1)} aria-label="التالي">‹</button>
      <button className="ad-carousel__arrow ad-carousel__arrow--prev" onClick={() => go(index - 1)} aria-label="السابق">›</button>
      <div className="ad-carousel__dots">
        {ads.map((a, i) => (
          <button key={a.id} className={`dot${i === index ? ' active' : ''}`} onClick={() => go(i)} aria-label={`إعلان ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}
