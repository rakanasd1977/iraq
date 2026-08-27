import type { ReactNode, SVGProps } from 'react';

const Icon = ({ paths, stroke = 'currentColor', width = '1em', height = '1em', ...rest }: { paths: ReactNode } & SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width={width}
    height={height}
    fill="none"
    stroke={stroke}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {paths}
  </svg>
);

const STORE_PATHS = (
  <>
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
    <path d="M2 7h20" />
    <path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
  </>
);

const UTENSILS_PATHS = (
  <>
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
    <path d="M7 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
  </>
);

const BED_PATHS = (
  <>
    <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
    <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
    <path d="M12 4v6" />
    <path d="M2 18h20" />
  </>
);

const PLANE_PATHS = (
  <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
);

const LUGGAGE_PATHS = (
  <>
    <path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2" />
    <path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14" />
    <path d="M10 20h4" />
    <circle cx="16" cy="20" r="2" />
    <circle cx="8" cy="20" r="2" />
  </>
);

const BAG_PATHS = (
  <>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </>
);

const PHONE_PATHS = (
  <>
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M11 18h2" />
  </>
);

const SHIRT_PATHS = (
  <>
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
  </>
);

const APPLE_PATHS = (
  <>
    <path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" />
    <path d="M10 2c1 .5 2 2 2 5" />
  </>
);

const HOUSE_PATHS = (
  <>
    <path d="M3 9.5 12 3l9 6.5" />
    <path d="M5 8.5V21h14V8.5" />
    <path d="M10 21v-6h4v6" />
  </>
);

const CONSTRUCTION_PATHS = (
  <>
    <path d="M6 2v14" />
    <path d="M6 2 17 7v5" />
    <path d="M17 17a2 2 0 0 1-4 0" />
    <path d="M10 22v-8" />
    <path d="M3 22h18" />
  </>
);

interface ServiceVisual {
  icon: ReactNode;
  color: string;
  dark: string;
  label: string;
}

const MAP: Record<string, ServiceVisual> = {
  stores: { icon: <Icon stroke="#e8590c" paths={STORE_PATHS} />, color: '#fff0e8', dark: '#6b4633', label: 'متاجر' },
  restaurants: { icon: <Icon stroke="#f76707" paths={UTENSILS_PATHS} />, color: '#fff3e0', dark: '#6b5526', label: 'مطاعم' },
  hotels: { icon: <Icon stroke="#1971c2" paths={BED_PATHS} />, color: '#e8f4ff', dark: '#2d466b', label: 'فنادق' },
  flights: { icon: <Icon stroke="#0ca678" paths={PLANE_PATHS} />, color: '#e8f7f0', dark: '#2d5c46', label: 'طيران' },
  travel_offices: { icon: <Icon stroke="#7048e8" paths={LUGGAGE_PATHS} />, color: '#efe8ff', dark: '#4a3a6b', label: 'مكاتب سفر' },
  pharmacies: { icon: <Icon stroke="#e8590c" paths={CONSTRUCTION_PATHS} />, color: '#fff0e8', dark: '#6b4633', label: 'مواد انشائية' },
  electronics: { icon: <Icon stroke="#1098ad" paths={PHONE_PATHS} />, color: '#e6f7f9', dark: '#2d5057', label: 'إلكترونيات' },
  fashion: { icon: <Icon stroke="#ae3ec9" paths={SHIRT_PATHS} />, color: '#f8e9fb', dark: '#55315f', label: 'أزياء' },
  grocery: { icon: <Icon stroke="#51cf66" paths={APPLE_PATHS} />, color: '#ecfbe9', dark: '#2f5232', label: 'بقالة' },
  home_services: { icon: <Icon stroke="#f59f00" paths={HOUSE_PATHS} />, color: '#fff7e0', dark: '#5d4a1f', label: 'مواد منزلية' },
};

export function serviceVisual(slug: string): ServiceVisual {
  const def = MAP[slug];
  if (def) return def;
  return { icon: <Icon stroke="#f08c00" paths={BAG_PATHS} />, color: '#fff0e8', dark: '#5a4633', label: slug };
}

/* ===================== أيقونات الواجهة الموحّدة (SVG) ===================== */

const SEARCH_PATHS = (
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </>
);

const BELL_PATHS = (
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>
);

const CART_PATHS = (
  <>
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </>
);

const SUN_PATHS = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </>
);

const MOON_PATHS = <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;

const PIN_PATHS = (
  <>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </>
);

const CHEVRON_DOWN_PATHS = <path d="m6 9 6 6 6-6" />;

const HOME_PATHS = (
  <>
    <path d="M3 9.5 12 3l9 6.5" />
    <path d="M5 8.5V21h14V8.5" />
    <path d="M10 21v-6h4v6" />
  </>
);

const BOX_PATHS = (
  <>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </>
);

const USER_PATHS = (
  <>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);

const STAR_PATHS = <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />;

export const IconSearch = (p: SVGProps<SVGSVGElement>) => <Icon width="1.15em" height="1.15em" paths={SEARCH_PATHS} {...p} />;
export const IconBell = (p: SVGProps<SVGSVGElement>) => <Icon width="1.15em" height="1.15em" paths={BELL_PATHS} {...p} />;
export const IconCart = (p: SVGProps<SVGSVGElement>) => <Icon width="1.2em" height="1.2em" paths={CART_PATHS} {...p} />;
export const IconSun = (p: SVGProps<SVGSVGElement>) => <Icon width="1.15em" height="1.15em" paths={SUN_PATHS} {...p} />;
export const IconMoon = (p: SVGProps<SVGSVGElement>) => <Icon width="1.15em" height="1.15em" paths={MOON_PATHS} {...p} />;
export const IconPin = (p: SVGProps<SVGSVGElement>) => <Icon width="1em" height="1em" paths={PIN_PATHS} {...p} />;
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => <Icon width="0.9em" height="0.9em" paths={CHEVRON_DOWN_PATHS} {...p} />;
export const IconHome = (p: SVGProps<SVGSVGElement>) => <Icon width="1.2em" height="1.2em" paths={HOME_PATHS} {...p} />;
export const IconBox = (p: SVGProps<SVGSVGElement>) => <Icon width="1.2em" height="1.2em" paths={BOX_PATHS} {...p} />;
export const IconUser = (p: SVGProps<SVGSVGElement>) => <Icon width="1.2em" height="1.2em" paths={USER_PATHS} {...p} />;
export const IconStar = (p: SVGProps<SVGSVGElement>) => <Icon width="1em" height="1em" paths={STAR_PATHS} {...p} />;
