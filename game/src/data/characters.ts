// Roster data shared by the simulation (stats) and the renderer (look).
export type CharId = 'vayu' | 'phloeng' | 'chantra';

export interface CharacterDef {
  id: CharId;
  name: string;
  nameEn: string;
  title: string;
  element: string;
  bio: string;
  /** Main energy colour (linear-ish hex, boosted for glow in the renderer). */
  accent: number;
  accent2: number;
  armor: number;
  suit: number;
  /** Walk/dash/jump speed multiplier. */
  speed: number;
  /** Damage multiplier. */
  power: number;
  hp: number;
  /** Projectile speed, metres per second. */
  projSpeed: number;
  moves: { orb: string; rush: string; rising: string; super: string };
  /** Body proportions: [shoulder width, overall bulk, height]. */
  build: [number, number, number];
}

export const CHARACTERS: Record<CharId, CharacterDef> = {
  vayu: {
    id: 'vayu',
    name: 'วายุ',
    nameEn: 'VAYU',
    title: 'ทายาทแห่งพายุ',
    element: 'สายฟ้า',
    bio: 'เร็วที่สุดในสามคน ลูกพลังพุ่งไว ต่อคอมโบง่าย แต่รับดาเมจได้น้อย',
    accent: 0x2fd8ff,
    accent2: 0xb9f4ff,
    armor: 0x1d2c4a,
    suit: 0x0b111e,
    speed: 1.12,
    power: 0.93,
    hp: 950,
    projSpeed: 11,
    moves: { orb: 'อัสนีบาต', rush: 'สายฟ้าแลบ', rising: 'พายุหมุนฟ้า', super: 'พิโรธวายุ' },
    build: [1.0, 0.95, 1.0],
  },
  phloeng: {
    id: 'phloeng',
    name: 'เพลิง',
    nameEn: 'PHLOENG',
    title: 'นักรบเพลิงกาฬ',
    element: 'ไฟ',
    bio: 'ช้าแต่หนัก ทุกหมัดเจ็บ ทนทานที่สุด ลูกไฟช้าแต่ใหญ่',
    accent: 0xff5418,
    accent2: 0xffc247,
    armor: 0x3b1511,
    suit: 0x170a08,
    speed: 0.9,
    power: 1.16,
    hp: 1080,
    projSpeed: 8.5,
    moves: { orb: 'ลูกไฟพิฆาต', rush: 'กระทิงเพลิง', rising: 'เสาเพลิง', super: 'อัคคีประลัย' },
    build: [1.12, 1.12, 1.03],
  },
  chantra: {
    id: 'chantra',
    name: 'จันทรา',
    nameEn: 'CHANTRA',
    title: 'ผู้พิทักษ์แสงจันทร์',
    element: 'จันทรา',
    bio: 'สมดุลรอบด้าน เคียวจันทร์เร็วที่สุด ระยะดี เหมาะกับคนชอบคุมระยะ',
    accent: 0xb46bff,
    accent2: 0xff8ad8,
    armor: 0xd9d3ea,
    suit: 0x19132a,
    speed: 1.0,
    power: 1.0,
    hp: 1000,
    projSpeed: 12.5,
    moves: { orb: 'เคียวจันทร์', rush: 'เงาจันทร์', rising: 'จันทร์เสี้ยวทะยาน', super: 'จันทรุปราคา' },
    build: [0.94, 0.9, 0.98],
  },
};

export const ROSTER: CharId[] = ['vayu', 'phloeng', 'chantra'];
