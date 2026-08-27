import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { ProviderCard } from '../components/ProviderCard';
import { AdsRow } from '../components/AdsRow';
import { EmptyState } from '../components/EmptyState';
import { publicApi } from '../api';
import { useGovernorate } from '../context/GovernorateContext';

const SORTS = [
  { v: '', label: 'الأكثر تقييماً' },
  { v: 'sold', label: 'الأكثر مبيعاً' },
  { v: 'recent', label: 'الأحدث' },
  { v: 'name', label: 'بالاسم' },
];

function SearchSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="chips">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="skel" style={{ width: 70, height: 30, borderRadius: 999 }} />
        ))}
      </div>
      <div className="prov-grid--search">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div className="skel skel--circle" style={{ width: 56, height: 56, margin: '0 auto' }} />
            <div className="skel skel--title" style={{ margin: '10px auto 0', width: '70%' }} />
            <div className="skel skel--text" style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Search() {
  const { governorates, governorate, select } = useGovernorate();
  const [params, setParams] = useSearchParams();
  const [services, setServices] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sort, setSort] = useState('');
  const [text, setText] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const pageRef = useRef(1);

  const q = params.get('q') || '';
  const service = params.get('service') || '';
  const govCode = governorate ? governorate.code : '';

  useEffect(() => setText(q), [q]);

  const submitSearch = () => {
    const v = text.trim();
    const sp = new URLSearchParams(params);
    if (v) sp.set('q', v);
    else sp.delete('q');
    sp.delete('service');
    setParams(sp);
  };

  // رابط عميق يحمل gov: نُزامن المحافظة الحالية معه (وبالعكس نحدث الرابط عند الاختيار)
  const urlGov = params.get('gov') || '';
  useEffect(() => {
    if (urlGov && urlGov !== govCode) {
      const g = governorates.find((x) => x.code === urlGov);
      if (g) select(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlGov]);

  useEffect(() => {
    if (q || service) return;
    publicApi
      .services(govCode)
      .then((rows) => setServices(rows || []))
      .catch(() => setServices([]));
  }, [govCode, q, service]);

  const fetchPage = (pg: number, append: boolean) => {
    return publicApi
      .providers(
        {
          q,
          governorate_code: govCode,
          service_slug: service,
          sort,
          min_rating: minRating || undefined,
          verified: verifiedOnly ? '1' : undefined,
          page: pg,
        },
        true
      )
      .then((res) => {
        const rows = (res && res.data) || [];
        const meta = res && res.meta;
        if (append) {
          setProviders((prev) => [...prev, ...rows]);
        } else {
          setProviders(rows);
        }
        setTotal(meta ? meta.total : rows.length);
        pageRef.current = pg;
        setHasMore(Boolean(meta && meta.page * meta.limit < meta.total));
        return rows;
      });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setHasMore(false);
    fetchPage(1, false)
      .then(() => alive && undefined)
      .catch(() => alive && setProviders([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, govCode, service, sort, minRating, verifiedOnly]);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    fetchPage(pageRef.current + 1, true)
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const chooseGov = (g: any) => {
    select(g);
    const sp = new URLSearchParams(params);
    sp.set('gov', g.code);
    window.location.hash = `#/search?${sp.toString()}`;
  };

  const chooseService = (slug: string) => {
    const sp = new URLSearchParams(params);
    if (slug) sp.set('service', slug);
    else sp.delete('service');
    setParams(sp);
  };

  return (
    <div className="page">
      <TopBar search={{ value: text, onChange: setText, onSubmit: submitSearch }} />
      <div className="chips">
        {governorates.map((g) => (
          <button key={g.id} className={`chip${govCode === g.code ? ' chip--active' : ''}`} onClick={() => chooseGov(g)} type="button">
            {g.name_ar}
          </button>
        ))}
      </div>

      {!q && !service && services.length > 0 && (
        <div className="chips" style={{ paddingTop: 0 }}>
          <button className={`chip${service === '' ? ' chip--active' : ''}`} onClick={() => chooseService('')} type="button">
            كل الخدمات
          </button>
          {services.map((s) => (
            <button key={s.id} className={`chip${service === s.slug ? ' chip--active' : ''}`} onClick={() => chooseService(s.slug)} type="button">
              {s.name_ar}
            </button>
          ))}
        </div>
      )}

      {!q && !service && <AdsRow />}

      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div className="seg" style={{ padding: 0 }}>
          {[
            { v: 0, label: 'أي تقييم' },
            { v: 4, label: '4★+' },
            { v: 3, label: '3★+' },
          ].map((s) => (
            <button
              key={s.v}
              type="button"
              className={`seg__btn${minRating === s.v ? ' seg__btn--active' : ''}`}
              onClick={() => setMinRating(s.v)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          className={`chip${verifiedOnly ? ' chip--active' : ''}`}
          style={{ margin: 0, height: 32 }}
          onClick={() => setVerifiedOnly((v) => !v)}
          type="button"
        >
          ✔️ موثّق
        </button>
      </div>

      {loading ? (
        <SearchSkeleton />
      ) : (
        <>
          <div className="row row--between" style={{ marginBottom: 8 }}>
            <span className="muted">{total > 0 ? `${total} مزود` : 'بحث'}</span>
            <div className="seg" style={{ padding: 0 }}>
              {SORTS.map((s) => (
                <button
                  key={s.v}
                  type="button"
                  className={`seg__btn${sort === s.v ? ' seg__btn--active' : ''}`}
                  onClick={() => setSort(s.v)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {providers.length ? (
            <>
              <div className="prov-grid--search">
                {providers.map((p) => <ProviderCard key={p.id} provider={p} compact />)}
              </div>
              {hasMore && (
                <button className="btn btn--outline btn--block" onClick={loadMore} disabled={loadingMore} type="button" style={{ marginTop: 6 }}>
                  {loadingMore ? 'جارٍ التحميل...' : 'عرض المزيد'}
                </button>
              )}
            </>
          ) : (
            <EmptyState
              icon="🔎"
              title="لا توجد نتائج"
              sub={q ? `لا يوجد مزود يطابق «${q}» في ${governorate ? governorate.name_ar : ''}` : 'جرّب البحث بكلمة أخرى أو غيّر المحافظة'}
            />
          )}
        </>
      )}
    </div>
  );
}
