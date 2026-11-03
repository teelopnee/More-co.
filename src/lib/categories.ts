import { fuzzyIncludes, skeleton } from '../slip/text';

export type TxType = 'expense' | 'income';

export interface Category {
  id: string;
  type: TxType;
  name: string;
  emoji: string;
  color: string;
  order: number;
  hidden?: boolean;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', type: 'expense', name: 'อาหาร', emoji: '🍜', color: '#f97316', order: 1 },
  { id: 'drink', type: 'expense', name: 'เครื่องดื่ม/ขนม', emoji: '🧋', color: '#d97706', order: 2 },
  { id: 'grocery', type: 'expense', name: 'ของใช้', emoji: '🧺', color: '#65a30d', order: 3 },
  { id: 'transport', type: 'expense', name: 'เดินทาง', emoji: '🚗', color: '#0284c7', order: 4 },
  { id: 'shopping', type: 'expense', name: 'ช้อปปิ้ง', emoji: '🛍️', color: '#db2777', order: 5 },
  { id: 'bills', type: 'expense', name: 'บิล/ค่าบริการ', emoji: '💡', color: '#ca8a04', order: 6 },
  { id: 'home', type: 'expense', name: 'ที่พัก', emoji: '🏠', color: '#7c3aed', order: 7 },
  { id: 'health', type: 'expense', name: 'สุขภาพ', emoji: '💊', color: '#dc2626', order: 8 },
  { id: 'fun', type: 'expense', name: 'บันเทิง', emoji: '🎬', color: '#9333ea', order: 9 },
  { id: 'edu', type: 'expense', name: 'การศึกษา', emoji: '📚', color: '#2563eb', order: 10 },
  { id: 'family', type: 'expense', name: 'ครอบครัว', emoji: '👨‍👩‍👧', color: '#0d9488', order: 11 },
  { id: 'merit', type: 'expense', name: 'ทำบุญ/ให้', emoji: '🙏', color: '#b45309', order: 12 },
  { id: 'transfer', type: 'expense', name: 'โอนให้คน', emoji: '💸', color: '#475569', order: 13 },
  { id: 'other-ex', type: 'expense', name: 'อื่นๆ', emoji: '📦', color: '#64748b', order: 99 },
  { id: 'salary', type: 'income', name: 'เงินเดือน', emoji: '💼', color: '#059669', order: 1 },
  { id: 'side', type: 'income', name: 'รายได้เสริม', emoji: '💰', color: '#16a34a', order: 2 },
  { id: 'sell', type: 'income', name: 'ขายของ', emoji: '🏷️', color: '#0891b2', order: 3 },
  { id: 'received', type: 'income', name: 'ได้รับโอน', emoji: '📥', color: '#0d9488', order: 4 },
  { id: 'other-in', type: 'income', name: 'อื่นๆ', emoji: '✨', color: '#64748b', order: 99 },
];

export const FALLBACK_CATEGORY: Record<TxType, string> = { expense: 'other-ex', income: 'received' };

// Keyword → category. Matched against counterparty + memo.
const KEYWORDS: [string, string[]][] = [
  ['salary', ['เงินเดือน', 'salary', 'payroll']],
  ['sell', ['ค่าสินค้า', 'ขายของ']],
  ['food', ['ค่าข้าว', 'ข้าว', 'อาหาร', 'ก๋วยเตี๋ยว', 'ส้มตำ', 'หมูกระทะ', 'ชาบู', 'สุกี้', 'ไลน์แมน', 'lineman', 'line man', 'grabfood', 'grab food', 'foodpanda', 'robinhood', 'kfc', 'mcdonald', 'แมคโดนัลด์', 'เอ็มเค', 'mk restaurant', 'บุฟเฟ่ต์', 'ร้านอาหาร', 'ข้าวมันไก่', 'ข้าวแกง']],
  ['drink', ['กาแฟ', 'coffee', 'cafe', 'คาเฟ่', 'starbucks', 'สตาร์บัคส์', 'amazon cafe', 'อเมซอน', 'ชานม', 'ชาไข่มุก', 'ขนม', 'bakery', 'เบเกอรี่', 'cha tra mue', 'ชาตรามือ']],
  ['grocery', ['ซีพี ออลล์', 'cp all', 'เซเว่น', '7-eleven', '7 eleven', 'โลตัส', 'lotus', 'บิ๊กซี', 'big c', 'แม็คโคร', 'makro', 'tops', 'ท็อปส์', 'แฟมิลี่มาร์ท', 'familymart', 'lawson', 'ลอว์สัน', 'วัตสัน', 'watsons', 'บู๊ทส์', 'boots']],
  ['transport', ['grab', 'แกร็บ', 'bolt', 'โบลท์', 'ปตท', 'ptt', 'shell', 'เชลล์', 'บางจาก', 'bangchak', 'caltex', 'คาลเท็กซ์', 'esso', 'บีทีเอส', 'bts', 'mrt', 'รถไฟฟ้า', 'ทางด่วน', 'easy pass', 'm-flow', 'แท็กซี่', 'taxi', 'ค่ารถ', 'ค่าน้ำมัน', 'ที่จอดรถ', 'parking']],
  ['shopping', ['shopee', 'ช้อปปี้', 'lazada', 'ลาซาด้า', 'tiktok', 'ติ๊กต็อก', 'central', 'เซ็นทรัล', 'robinson', 'โรบินสัน', 'uniqlo', 'ยูนิโคล่', 'ikea', 'อิเกีย', 'homepro', 'โฮมโปร']],
  ['bills', ['การไฟฟ้า', 'กฟน', 'กฟภ', 'ค่าไฟ', 'การประปา', 'กปน', 'กปภ', 'ค่าน้ำ', 'แอดวานซ์', 'advanced info', 'ais', 'ทรู', 'true', 'ดีแทค', 'dtac', '3bb', 'อินเทอร์เน็ต', 'internet', 'netflix', 'spotify', 'youtube', 'icloud', 'apple.com', 'google', 'ค่าโทรศัพท์', 'ประกัน', 'insurance']],
  ['home', ['ค่าเช่า', 'เช่าห้อง', 'หอพัก', 'คอนโด', 'อพาร์ทเม้นท์', 'นิติบุคคล', 'ค่าส่วนกลาง', 'ค่าห้อง']],
  ['health', ['โรงพยาบาล', 'รพ.', 'คลินิก', 'clinic', 'ร้านยา', 'เภสัช', 'pharmacy', 'ฟิตเนส', 'fitness', 'ทันตกรรม', 'หมอฟัน']],
  ['fun', ['เมเจอร์', 'major cineplex', 'sf cinema', 'เอสเอฟ', 'หนัง', 'คอนเสิร์ต', 'concert', 'steam', 'playstation', 'เกม', 'ticket', 'บัตรคอนเสิร์ต']],
  ['edu', ['ค่าเทอม', 'โรงเรียน', 'มหาวิทยาลัย', 'คอร์ส', 'course', 'กวดวิชา', 'หนังสือ']],
  ['merit', ['วัด', 'ทำบุญ', 'มูลนิธิ', 'บริจาค', 'donation', 'ใส่ซอง', 'ซองงาน']],
  ['family', ['ให้แม่', 'ให้พ่อ', 'ค่าขนมลูก', 'ครอบครัว']],
];

/** Normalised key for remembering a counterparty → category choice. */
export function counterpartyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const k = skeleton(name).replace(/^(นาย|นางสาว|นาง|นส|mr|mrs|ms|miss)/, '');
  return k.length >= 3 ? k : null;
}

export function guessCategory(
  type: TxType,
  counterparty: string | null,
  memo: string | null,
  learned: Map<string, string>,
  categories: Category[],
): string {
  const valid = new Set(categories.filter((c) => c.type === type && !c.hidden).map((c) => c.id));
  const key = counterpartyKey(counterparty);
  if (key && learned.has(key) && valid.has(learned.get(key)!)) return learned.get(key)!;

  const hay = `${memo ?? ''}  ${counterparty ?? ''}`;
  for (const [cat, words] of KEYWORDS) {
    if (!valid.has(cat)) continue;
    if (words.some((w) => (w.length <= 4 ? new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(hay) : fuzzyIncludes(hay, w)))) return cat;
  }
  if (type === 'expense' && counterparty && /^(นาย|นาง|น\.?ส\.?|mr|mrs|ms|miss)\b/i.test(counterparty.trim()) && valid.has('transfer')) return 'transfer';
  const fb = FALLBACK_CATEGORY[type];
  return valid.has(fb) ? fb : [...valid][0] ?? fb;
}
