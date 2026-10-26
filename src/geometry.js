export const POSITIONS = { 'top-center': '顶部居中', 'left-center': '左侧居中', 'right-center': '右侧居中', 'bottom-center': '底部居中', 'top-left': '左上角', 'top-right': '右上角' };
export const DEFAULT_SETTINGS = { position: 'top-center', scale: 1, motion: 'full', displayId: null, enabled: true };
export function normalizeSettings(value = {}) {
  return {
    position: Object.hasOwn(POSITIONS, value.position) ? value.position : 'top-center',
    scale: [0.85,1,1.15].includes(value.scale) ? value.scale : 1,
    motion: value.motion === 'reduced' ? 'reduced' : 'full',
    displayId: Number.isInteger(value.displayId) ? value.displayId : null,
    enabled: value.enabled !== false
  };
}
export function windowBounds(work, settings, width = 440, height = 460) {
  const w = Math.min(work.width, Math.ceil(width * settings.scale));
  const h = Math.min(work.height, Math.ceil(height * settings.scale));
  const edge = 4, p = settings.position;
  const x = p.includes('left') ? work.x + edge : p.includes('right') ? work.x + work.width - w - edge : work.x + (work.width - w) / 2;
  const y = p.startsWith('top') ? work.y + edge : p.startsWith('bottom') ? work.y + work.height - h - edge : work.y + (work.height - h) / 2;
  return { x: Math.round(Math.max(work.x, Math.min(x, work.x+work.width-w))), y: Math.round(Math.max(work.y, Math.min(y, work.y+work.height-h))), width: w, height: h };
}
export function containsPoint(rect, x, y) {
  if(x<rect.x||y<rect.y||x>rect.x+rect.width||y>rect.y+rect.height)return false;
  const r=Math.min(rect.radius||0,rect.width/2,rect.height/2);
  const cx=Math.max(rect.x+r,Math.min(x,rect.x+rect.width-r));
  const cy=Math.max(rect.y+r,Math.min(y,rect.y+rect.height-r));
  return (x-cx)**2+(y-cy)**2<=r*r;
}
