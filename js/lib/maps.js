// Google Maps 深層連結。日文的店名+地址解析很準。
// mode: 'walk' | 'subway' | 'train' | 'bus' | 'tram' | 'shinkansen' | 'taxi' | 'car'
const MODE_TO_TRAVEL = {
  walk: 'walking',
  subway: 'transit', train: 'transit', bus: 'transit', tram: 'transit', shinkansen: 'transit',
  taxi: 'driving', car: 'driving',
};

export function mapsUrl(query, mode = 'transit') {
  const travelmode = MODE_TO_TRAVEL[mode] || (mode === 'walking' || mode === 'driving' ? mode : 'transit');
  return `https://www.google.com/maps/dir/?api=1&travelmode=${travelmode}&destination=${encodeURIComponent(query)}`;
}
