function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// مسافة هافرساين بالكيلومترات بين نقطتين على الكرة الأرضية
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// أقرب محافظة لموقع الزبون من قائمة تحتوي حقول lat/lng (تتجاهل الفارغة)
function nearestGovernorate(lat, lng, list) {
  let best = null;
  let bestDist = Infinity;
  for (const g of list || []) {
    if (g.lat == null || g.lng == null) continue;
    const d = haversineKm(lat, lng, Number(g.lat), Number(g.lng));
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  if (!best) return null;
  return { ...best, distance_km: Math.round(bestDist * 100) / 100 };
}

module.exports = { haversineKm, nearestGovernorate };
