import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from 'react';

interface Point {
  clientX?: number;
  clientY?: number;
}

function dist(t1: Point, t2: Point): number {
  const dx = (t1.clientX || 0) - (t2.clientX || 0);
  const dy = (t1.clientY || 0) - (t2.clientY || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const MAX_SCALE = 4;

// معرض صور قابل للسحب (swipe) مع تكبير باللمس (pinch/double-tap) في عرض ملء الشاشة.
export function Gallery({ images = [], icon = '🛍️', title = '' }: { images?: string[]; icon?: string; title?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const lbTrackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [lb, setLb] = useState(false);
  const [lbActive, setLbActive] = useState(0);
  const [zoom, setZoom] = useState({ scale: 1, tx: 0, ty: 0 });

  const gesture = useRef({ dist: 0, scale: 1, tx: 0, ty: 0, px: 0, py: 0, lastTap: 0 });

  useEffect(() => {
    if (!lb) {
      setZoom({ scale: 1, tx: 0, ty: 0 });
    }
  }, [lb]);

  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== active && i >= 0 && i < images.length) setActive(i);
  };

  const onLbScroll = () => {
    const el = lbTrackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== lbActive) {
      setLbActive(i);
      setZoom({ scale: 1, tx: 0, ty: 0 });
    }
  };

  const openLb = (i: number) => {
    setLbActive(i);
    setLb(true);
  };

  const onZoomStart = (e: ReactTouchEvent) => {
    if (e.touches.length >= 2) {
      gesture.current.dist = dist(e.touches[0], e.touches[1]);
      gesture.current.scale = zoom.scale;
      gesture.current.tx = zoom.tx;
      gesture.current.ty = zoom.ty;
    } else if (e.touches.length === 1) {
      gesture.current.px = e.touches[0].clientX;
      gesture.current.py = e.touches[0].clientY;
      gesture.current.tx = zoom.tx;
      gesture.current.ty = zoom.ty;
    }
  };

  const onZoomMove = (e: ReactTouchEvent) => {
    if (e.touches.length >= 2 && gesture.current.dist > 0) {
      const next = clamp((gesture.current.scale * dist(e.touches[0], e.touches[1])) / gesture.current.dist, 1, MAX_SCALE);
      setZoom((z) => ({ ...z, scale: next, tx: next <= 1 ? 0 : z.tx, ty: next <= 1 ? 0 : z.ty }));
    } else if (e.touches.length === 1 && zoom.scale > 1) {
      const dx = e.touches[0].clientX - gesture.current.px;
      const dy = e.touches[0].clientY - gesture.current.py;
      const maxPan = 120 * (zoom.scale - 1);
      setZoom((z) => ({
        ...z,
        tx: clamp(gesture.current.tx + dx, -maxPan, maxPan),
        ty: clamp(gesture.current.ty + dy, -maxPan, maxPan),
      }));
    }
  };

  const onZoomEnd = () => {
    const now = Date.now();
    setZoom((z) => (z.scale <= 1.02 ? { scale: 1, tx: 0, ty: 0 } : z));
    gesture.current.dist = 0;
    const isDouble = now - gesture.current.lastTap < 300;
    gesture.current.lastTap = now;
    if (isDouble) toggleZoom();
  };

  const toggleZoom = () => {
    setZoom((z) => {
      if (z.scale > 1) return { scale: 1, tx: 0, ty: 0 };
      return { scale: 2.5, tx: 0, ty: 0 };
    });
  };

  const onWheelZoom = (e: ReactWheelEvent) => {
    if (lb) {
      setZoom((z) => {
        const next = clamp(z.scale + (e.deltaY < 0 ? 0.3 : -0.3), 1, MAX_SCALE);
        return { ...z, scale: next, tx: next <= 1 ? 0 : z.tx, ty: next <= 1 ? 0 : z.ty };
      });
    }
  };

  const slides: string[] = images.length
    ? images
    : [''];

  return (
    <>
      <div className="gallery">
        <div className="gallery__track" ref={trackRef} onScroll={onTrackScroll}>
          {slides.map((img, i) => (
            <div className="gallery__slide" key={i} onClick={() => img && openLb(i)}>
              {img ? (
                <img src={img} alt={title} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
              ) : (
                <span className="gallery__ph">{icon}</span>
              )}
            </div>
          ))}
        </div>
        {slides.length > 1 && (
          <div className="gallery__dots">
            {slides.map((_, i) => (
              <span key={i} className={`gallery__dot${i === active ? ' gallery__dot--on' : ''}`} />
            ))}
          </div>
        )}
      </div>

      {lb && slides[lbActive] && (
        <div className="lb" onWheel={onWheelZoom} onClick={() => setLb(false)}>
          <button className="lb__close" type="button" onClick={() => setLb(false)} aria-label="إغلاق">✕</button>
          <div
            className="lb__track"
            ref={lbTrackRef}
            onScroll={onLbScroll}
            onClick={(e) => e.stopPropagation()}
          >
            {slides.map((img, i) => {
              const isActive = i === lbActive;
              return (
                <div className="lb__slide" key={i}>
                  <div
                    className={`lb__zoom${isActive && zoom.scale > 1 ? ' lb__zoom--active' : ''}`}
                    style={isActive ? { transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` } : undefined}
                    onTouchStart={isActive ? onZoomStart : undefined}
                    onTouchMove={isActive ? onZoomMove : undefined}
                    onTouchEnd={isActive ? onZoomEnd : undefined}
                    onDoubleClick={isActive ? toggleZoom : undefined}
                  >
                    <img src={img} alt={title} draggable={false} decoding="async" />
                  </div>
                </div>
              );
            })}
          </div>
          {slides.length > 1 && (
            <div className="lb__dots" onClick={(e) => e.stopPropagation()}>
              {slides.map((_, i) => (
                <span key={i} className={`lb__dot${i === lbActive ? ' lb__dot--on' : ''}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
