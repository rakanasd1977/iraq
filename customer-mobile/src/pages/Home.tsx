import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { ServiceGrid } from '../components/ServiceGrid';
import { ProviderCard } from '../components/ProviderCard';
import { AdsRow } from '../components/AdsRow';
import { MostOrderedSection } from '../components/MostOrderedSection';
import { FlashDeals } from '../components/FlashDeals';
import { DealCard } from '../components/DealCard';
import { RecentCard } from '../components/RecentCard';
import { SectionHead } from '../components/SectionHead';
import { Toast } from '../components/Toast';
import { publicApi } from '../api';
import { useGovernorate } from '../context/GovernorateContext';
import { getRecent } from '../recentlyViewed';

function HomeSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="skel" style={{ height: 150, borderRadius: 14 }} />
      <div className="skel skel--title" style={{ margin: '18px 0 10px' }} />
      <div className="grid-services">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="svc">
            <span className="skel skel--circle" style={{ width: 48, height: 48 }} />
            <span className="skel skel--text" style={{ width: '80%' }} />
          </div>
        ))}
      </div>
      <div className="skel" style={{ height: 130, borderRadius: 14 }} />
      <div className="skel skel--title" style={{ margin: '18px 0 10px' }} />
      <div className="hscroll">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ width: 150, flexShrink: 0 }}>
            <div className="skel skel--img" />
            <div className="skel skel--title" style={{ marginTop: 8 }} />
            <div className="skel skel--text" style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { governorate } = useGovernorate();
  const navigate = useNavigate();
  const [services, setServices] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showTop, setShowTop] = useState(false);
  const [recent] = useState(() => getRecent());
  const [sq, setSq] = useState('');
  const [toast, setToast] = useState('');
  const [promos, setPromos] = useState<any[]>([]);
  const [layout, setLayout] = useState<any[]>([]);

  const goSearch = () => {
    const query = sq.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 420);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    const govCode = governorate ? governorate.code : '';
    const layoutCall = typeof (publicApi as any).homeLayout === 'function'
      ? publicApi.homeLayout().catch(() => [])
      : Promise.resolve([]);
    Promise.all([
      publicApi.services(govCode),
      publicApi.providers({ governorate_code: govCode, limit: 8 }),
      publicApi.deals(16, govCode).catch(() => []),
      publicApi.coupons().catch(() => []),
      publicApi.promotions(govCode).catch(() => []),
      layoutCall,
    ])
      .then(([svc, prov, dl, cp, pr, lay]) => {
        if (!alive) return;
        setServices(svc || []);
        setProviders(prov || []);
        setDeals(dl || []);
        setCoupons(cp || []);
        setPromos(Array.isArray(pr) ? pr : []);
        setLayout(Array.isArray(lay) ? lay : []);
      })
      .catch(() => {
        if (!alive) return;
        setLoadError(true);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [governorate, reloadKey]);

  if (loading) {
    return (
      <div>
        <TopBar search={{ value: sq, onChange: setSq, onSubmit: goSearch }} />
        <HomeSkeleton />
      </div>
    );
  }

  const flash = deals.filter((d) => d.kind === 'products' && d.discount_percent > 0);
  const picks = deals.filter((d) => d.kind !== 'products');

  const homeTopAds = promos.filter((p) => p.placement === 'home_top');
  const mostOrderedAds = promos.filter((p) => p.placement === 'most_ordered');

  const sectionNodes: Record<string, any> = {
    hero_ads: <AdsRow key="hero_ads" placement="home_top" title="" variant="hero" className="home-hero" limit={6} initialAds={homeTopAds} />,
    service_grid: <ServiceGrid key="service_grid" services={services} />,
    flash_deals: <FlashDeals key="flash_deals" deals={flash} moreTo="/search?service=stores" />,
    coupons: coupons.length > 0 ? (
      <section key="coupons" className="home-block">
        <SectionHead icon="🎟️" title="كوبونات للتحصيل" moreTo="/coupons" />
        <div className="hscroll">
          {coupons.slice(0, 6).map((c) => (
            <button key={c.id} className="coup-pill" onClick={() => navigate('/coupons')} type="button">
              <span className="coup-pill__num" dir="ltr">
                {c.discount_type === 'fixed' ? `${c.discount_value.toLocaleString('en-US')} د.ع` : `${c.discount_value}%`}
              </span>
              <span className="coup-pill__code" dir="ltr">{c.code}</span>
            </button>
          ))}
        </div>
      </section>
    ) : null,
    featured_providers: (
      <section key="featured_providers" className="home-block">
        <SectionHead icon="🏆" title="مزودون مميزون" moreTo="/search" />
        <div className="prov-grid">
          {providers.map((p) => <ProviderCard key={p.id} provider={p} />)}
        </div>
        {!providers.length && (
          <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            لا يوجد مزودون نشطون حالياً — عد لاحقاً
          </div>
        )}
      </section>
    ),
    most_ordered: <MostOrderedSection key="most_ordered" limit={10} mostOrderedAds={mostOrderedAds} />,
    recently_viewed: recent.length > 0 ? (
      <section key="recently_viewed" className="home-block">
        <SectionHead icon="🕘" title="شوهد مؤخراً" moreTo="/search" />
        <div className="hscroll">
          {recent.map((r) => (
            <RecentCard key={`${r.type}-${r.id}`} entry={r} />
          ))}
        </div>
      </section>
    ) : null,
    picks: picks.length > 0 ? (
      <section key="picks" className="home-block">
        <SectionHead icon="🔥" title="مختارات مميزة" />
        <div className="hscroll">
          {picks.map((d) => <DealCard key={`${d.kind}-${d.item_id}`} deal={d} />)}
        </div>
      </section>
    ) : null,
  };

  const DEFAULT_LAYOUT = [
    { key: 'hero_ads', order: 1, enabled: true },
    { key: 'service_grid', order: 2, enabled: true },
    { key: 'flash_deals', order: 3, enabled: true },
    { key: 'coupons', order: 4, enabled: true },
    { key: 'featured_providers', order: 5, enabled: true },
    { key: 'most_ordered', order: 6, enabled: true },
    { key: 'recently_viewed', order: 7, enabled: true },
    { key: 'picks', order: 8, enabled: true },
  ];
  const orderedSections = (layout.length ? layout : DEFAULT_LAYOUT)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .filter((s) => s.enabled !== false)
    .map((s) => sectionNodes[s.key])
    .filter(Boolean);

  return (
    <div className="page">
      <TopBar search={{ value: sq, onChange: setSq, onSubmit: goSearch }} />

      {loadError && (
        <div className="conn-banner" role="alert">
          <span>تعذّر تحميل البيانات — تحقق من اتصالك</span>
          <button className="conn-banner__btn" type="button" onClick={reload}>إعادة المحاولة</button>
        </div>
      )}

      {orderedSections}

      {showTop && (
        <button className="backtop" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="العودة إلى الأعلى">
          ↑
        </button>
      )}
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
