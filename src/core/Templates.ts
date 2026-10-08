/**
 * Templates — a professional starter ecosystem. Every template is a REAL
 * recipe: opening it runs actual engine commands (doc.new → solid/gradient
 * fill layers → placed vector shapes → styled text layers), so what you get
 * is a genuine editable document, not a picture of one. The same recipe data
 * drives the gallery preview (a faithful schematic mock) and the execution.
 * Search + category filters run over this registry locally.
 */
import {Editor} from './DocumentStore';
import {History} from './HistoryManager';
import {TextStudio} from './engines/TextStudio';
import {LayerStyles} from './engines/LayerStyles';
import type {EffectSpec} from './engines/LayerStyles';
import {SvgEngine} from './engines/SvgEngine';

export type TemplateCategory =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'youtube'
  | 'business'
  | 'marketing'
  | 'posters'
  | 'flyers'
  | 'stories';

export type LayoutKind = 'center' | 'bottom' | 'split' | 'banner' | 'story' | 'minimal';

export interface TemplateDef {
  id: string;
  name: string;
  nameAr: string;
  category: TemplateCategory;
  width: number;
  height: number;
  /** Recipe palette (drives the real fill layers AND the preview mock). */
  bg: string;
  accent: string;
  fg: string;
  headline: string;
  sub?: string;
  layout: LayoutKind;
}

export const TEMPLATES: TemplateDef[] = [
  // ------------------------------------------------------------- Instagram
  {id: 'ig-quote', name: 'Quote Post', nameAr: 'منشور اقتباس', category: 'instagram', width: 1080, height: 1080, bg: '#101014', accent: '#3B82F6', fg: '#F4F4F6', headline: 'Design is thinking made visual', sub: '— Paul Rand', layout: 'center'},
  {id: 'ig-sale', name: 'Sale Announcement', nameAr: 'إعلان تخفيضات', category: 'instagram', width: 1080, height: 1080, bg: '#7F1D1D', accent: '#F59E0B', fg: '#FFFFFF', headline: 'UP TO 50% OFF', sub: 'This weekend only', layout: 'banner'},
  {id: 'ig-minimal', name: 'Minimal Product', nameAr: 'منتج بسيط', category: 'instagram', width: 1080, height: 1080, bg: '#EEF0F5', accent: '#17181D', fg: '#17181D', headline: 'New Collection', sub: 'Spring 2026', layout: 'minimal'},
  {id: 'ig-carousel', name: 'Tips Carousel Cover', nameAr: 'غلاف كاروسيل نصائح', category: 'instagram', width: 1080, height: 1080, bg: '#0F172A', accent: '#22D3EE', fg: '#F4F4F6', headline: '5 نصائح لمشروعك القادم', layout: 'split'},
  // -------------------------------------------------------------- Facebook
  {id: 'fb-event', name: 'Event Cover', nameAr: 'غلاف حدث', category: 'facebook', width: 1200, height: 630, bg: '#1E3A8A', accent: '#3B82F6', fg: '#FFFFFF', headline: 'Design Meetup 2026', sub: 'Cairo · October 24', layout: 'bottom'},
  {id: 'fb-offer', name: 'Offer Post', nameAr: 'منشور عرض', category: 'facebook', width: 1200, height: 630, bg: '#14532D', accent: '#84CC16', fg: '#FFFFFF', headline: 'خصم ٣٠٪ لفترة محدودة', layout: 'banner'},
  // ---------------------------------------------------------------- TikTok
  {id: 'tt-cover', name: 'Video Cover', nameAr: 'غلاف فيديو', category: 'tiktok', width: 1080, height: 1920, bg: '#17181D', accent: '#EC4899', fg: '#FFFFFF', headline: 'WATCH THIS', sub: 'قبل ما تبدأ تصميمك', layout: 'story'},
  {id: 'tt-tip', name: 'Quick Tip Frame', nameAr: 'إطار نصيحة سريعة', category: 'tiktok', width: 1080, height: 1920, bg: '#312E81', accent: '#A855F7', fg: '#FFFFFF', headline: 'خدعة الألوان السريعة', layout: 'story'},
  // --------------------------------------------------------------- YouTube
  {id: 'yt-thumb', name: 'Bold Thumbnail', nameAr: 'صورة مصغرة جريئة', category: 'youtube', width: 1280, height: 720, bg: '#450A0A', accent: '#F97316', fg: '#FFFFFF', headline: 'I BUILT THIS IN 10 MIN', layout: 'split'},
  {id: 'yt-banner', name: 'Channel Banner', nameAr: 'بانر القناة', category: 'youtube', width: 2048, height: 1152, bg: '#0F172A', accent: '#EF4444', fg: '#FFFFFF', headline: 'WEEKLY DESIGN BREAKDOWNS', layout: 'center'},
  // -------------------------------------------------------------- Business
  {id: 'bs-card', name: 'Business Card', nameAr: 'بطاقة أعمال', category: 'business', width: 1050, height: 600, bg: '#FFFFFF', accent: '#17181D', fg: '#17181D', headline: 'Yassin Studio', sub: 'Design & Direction', layout: 'minimal'},
  {id: 'bs-letter', name: 'Letterhead', nameAr: 'ترويسة رسمية', category: 'business', width: 2480, height: 3508, bg: '#FFFFFF', accent: '#1E3A8A', fg: '#17181D', headline: 'Company Name', sub: 'Official Document', layout: 'minimal'},
  // ------------------------------------------------------------- Marketing
  {id: 'mk-banner', name: 'Web Banner', nameAr: 'بانر ويب', category: 'marketing', width: 1600, height: 900, bg: '#082F49', accent: '#22D3EE', fg: '#FFFFFF', headline: 'Ship Faster With Photo Craft', sub: 'Start your free trial', layout: 'banner'},
  {id: 'mk-ad', name: 'Ad Creative', nameAr: 'إبداع إعلاني', category: 'marketing', width: 1080, height: 1350, bg: '#4C0519', accent: '#FB7185', fg: '#FFFFFF', headline: 'Limited Drop', sub: 'Shop now', layout: 'bottom'},
  // --------------------------------------------------------------- Posters
  {id: 'po-event', name: 'Event Poster', nameAr: 'ملصق حدث', category: 'posters', width: 1240, height: 1748, bg: '#101014', accent: '#F59E0B', fg: '#F4F4F6', headline: 'LIVE CONCERT', sub: 'Friday · 8 PM', layout: 'center'},
  {id: 'po-typo', name: 'Typography Poster', nameAr: 'ملصق طباعي', category: 'posters', width: 1240, height: 1748, bg: '#F5F5F4', accent: '#17181D', fg: '#17181D', headline: 'أفقي عمودي حروف', layout: 'minimal'},
  // ---------------------------------------------------------------- Flyers
  {id: 'fl-open', name: 'Opening Flyer', nameAr: 'فلاير افتتاح', category: 'flyers', width: 1240, height: 1748, bg: '#052E16', accent: '#10B981', fg: '#FFFFFF', headline: 'GRAND OPENING', sub: 'Join us this Friday', layout: 'split'},
  {id: 'fl-hiring', name: 'Hiring Flyer', nameAr: 'فلاير توظيف', category: 'flyers', width: 1240, height: 1748, bg: '#FFFFFF', accent: '#2563EB', fg: '#17181D', headline: 'We Are Hiring', sub: 'Send your portfolio', layout: 'bottom'},
  // --------------------------------------------------------------- Stories
  {id: 'st-quote', name: 'Story Quote', nameAr: 'ستوري اقتباس', category: 'stories', width: 1080, height: 1920, bg: '#111827', accent: '#22D3EE', fg: '#F9FAFB', headline: 'كل يوم تصميم جديد', layout: 'story'},
  {id: 'st-countdown', name: 'Story Countdown', nameAr: 'ستوري عد تنازلي', category: 'stories', width: 1080, height: 1920, bg: '#4A044E', accent: '#E879F9', fg: '#FFFFFF', headline: '٣ أيام', sub: 'حتى الإطلاق', layout: 'center'},
];

const ARABIC_RE = /[\u0600-\u06FF]/;

export const TemplateCategories: TemplateCategory[] = [
  'instagram', 'facebook', 'tiktok', 'youtube', 'business', 'marketing', 'posters', 'flyers', 'stories',
];

export const Templates = {
  all: () => TEMPLATES,

  byCategory(cat: TemplateCategory | 'all'): TemplateDef[] {
    return cat === 'all' ? TEMPLATES : TEMPLATES.filter(t => t.category === cat);
  },

  search(query: string): TemplateDef[] {
    const q = query.trim().toLowerCase();
    if (!q) {
      return TEMPLATES;
    }
    return TEMPLATES.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.nameAr.includes(query) ||
        t.category.includes(q) ||
        t.headline.toLowerCase().includes(q),
    );
  },

  /**
   * Open a template as a fresh real document. Every step below is a
   * registered engine command — layers are genuine and fully editable.
   */
  async create(tpl: TemplateDef, projectName?: string): Promise<void> {
    await Editor.newDocument(projectName || tpl.name, tpl.width, tpl.height);

    // Background: real solid fill layer (exact color, not just white canvas).
    await Editor.runCommand('layer.newFillLayer.solidColor', {color: tpl.bg});
    await Editor.runCommand('layer.setProps', {name: 'Background'});

    const W = tpl.width;
    const H = tpl.height;
    const short = Math.min(W, H);

    // Layout accents — real vector shapes placed through the SVG engine.
    const shapes = recipeShapes(tpl);
    for (const s of shapes) {
      await SvgEngine.importText(s.svg, s.name);
    }

    // Headline + sub — real text layers with RTL-aware direction.
    const rtlHead = ARABIC_RE.test(tpl.headline);
    const headSize = Math.round(short * (tpl.layout === 'story' ? 0.085 : 0.075));
    const headId = await TextStudio.add({
      text: tpl.headline,
      x: W * 0.08,
      y: headY(tpl.layout, H),
      sizePt: headSize,
      color: tpl.fg,
      rtl: rtlHead,
      align: layoutAlign(tpl.layout),
      box: {w: Math.round(W * 0.84), h: Math.round(headSize * 2.4)},
      name: 'Headline',
    });
    if (headId > 0) {
      await LayerStyles.apply(headId, headlineEffects(tpl.accent));
      await Editor.runCommand('layer.setProps', {layer: headId, name: 'Headline'});
    }

    if (tpl.sub) {
      const rtlSub = ARABIC_RE.test(tpl.sub);
      const subId = await TextStudio.add({
        text: tpl.sub,
        x: W * 0.08,
        y: headY(tpl.layout, H) + headSize * 1.9,
        sizePt: Math.round(headSize * 0.42),
        color: tpl.fg,
        rtl: rtlSub,
        align: layoutAlign(tpl.layout),
        box: {w: Math.round(W * 0.7), h: Math.round(headSize * 0.9)},
        name: 'Subtitle',
      });
      if (subId > 0) {
        await Editor.runCommand('layer.setProps', {layer: subId, opacity: 0.85});
      }
    }

    // Accent chip — a small brand-colored bar anchoring the composition.
    await SvgEngine.importText(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(short * 0.18)}" height="${Math.round(short * 0.02)}"><rect width="100%" height="100%" rx="8" fill="${tpl.accent}"/></svg>`,
      'Accent Bar',
    );

    History.push(`Template — ${tpl.name}`);
    await Editor.refresh();
  },
};

function headY(layout: LayoutKind, h: number): number {
  switch (layout) {
    case 'bottom':
    case 'banner':
      return h * 0.62;
    case 'story':
      return h * 0.42;
    case 'center':
      return h * 0.4;
    default:
      return h * 0.18;
  }
}

function layoutAlign(layout: LayoutKind) {
  return layout === 'minimal' || layout === 'split' ? ('left' as const) : ('center' as const);
}

/** Small vector accents per layout — each becomes a real vector layer. */
function recipeShapes(tpl: TemplateDef): Array<{name: string; svg: string; style?: EffectSpec[]}> {
  const W = tpl.width;
  const H = tpl.height;
  const short = Math.min(W, H);
  switch (tpl.layout) {
    case 'banner': {
      const bandH = Math.round(H * 0.24);
      return [
        {
          name: 'Accent Band',
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${bandH}"><rect width="100%" height="100%" fill="${tpl.accent}" opacity="0.92"/></svg>`,
        },
      ];
    }
    case 'split':
      return [
        {
          name: 'Side Panel',
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * 0.42)}" height="${H}"><rect width="100%" height="100%" fill="${tpl.accent}" opacity="0.16"/></svg>`,
        },
        {
          name: 'Corner Dot',
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(short * 0.1)}" height="${Math.round(short * 0.1)}"><circle cx="50%" cy="50%" r="50%" fill="${tpl.accent}"/></svg>`,
        },
      ];
    case 'story':
      return [
        {
          name: 'Glow Ring',
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(short * 0.62)}" height="${Math.round(short * 0.62)}"><circle cx="50%" cy="50%" r="46%" fill="none" stroke="${tpl.accent}" stroke-width="${Math.round(short * 0.02)}" opacity="0.85"/></svg>`,
        },
      ];
    case 'bottom':
      return [
        {
          name: 'Footer Card',
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round(H * 0.3)}"><rect width="100%" height="100%" rx="${Math.round(short * 0.04)}" fill="${tpl.accent}" opacity="0.18"/></svg>`,
        },
      ];
    case 'center':
      return [
        {
          name: 'Frame',
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * 0.86)}" height="${Math.round(H * 0.72)}"><rect x="2" y="2" width="100%-4" height="100%-4" rx="${Math.round(short * 0.05)}" fill="none" stroke="${tpl.accent}" stroke-width="${Math.max(3, Math.round(short * 0.006))}" opacity="0.9"/></svg>`,
        },
      ];
    default:
      return [];
  }
}

/** Headline effects — a restrained drop shadow so text pops on any bg. */
function headlineEffects(accent: string): EffectSpec[] {
  return [
    {
      kind: 'dropShadow',
      enabled: true,
      color: '#000000',
      opacity: 45,
      angle: 120,
      distance: 10,
      size: 18,
    },
    {
      kind: 'gradientOverlay',
      enabled: true,
      gradient: {from: accent, to: '#000000', angle: 90, style: 'linear', opacity: 22},
    },
  ];
}
