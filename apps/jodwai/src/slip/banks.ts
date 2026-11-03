import { fuzzyIncludes } from './text';

export interface BankInfo {
  id: string;
  name: string;
  color: string;
  /** Text clues that appear on the slip. */
  clues: string[];
}

// Bank codes follow the Bank of Thailand numbering used in slip QR codes.
export const BANKS: Record<string, BankInfo> = {
  '002': { id: 'bbl', name: 'กรุงเทพ', color: '#1e4598', clues: ['ธนาคารกรุงเทพ', 'ธ.กรุงเทพ', 'bangkok bank', 'bualuang'] },
  '004': { id: 'kbank', name: 'กสิกรไทย', color: '#138f2d', clues: ['กสิกรไทย', 'ธ.กสิกร', 'kasikorn', 'k plus', 'k+'] },
  '006': { id: 'ktb', name: 'กรุงไทย', color: '#1ba5e1', clues: ['กรุงไทย', 'krungthai', 'krung thai'] },
  '011': { id: 'ttb', name: 'ทีทีบี', color: '#0050f0', clues: ['ทหารไทยธนชาต', 'ttb'] },
  '014': { id: 'scb', name: 'ไทยพาณิชย์', color: '#4e2e7f', clues: ['ไทยพาณิชย์', 'scb easy', 'siam commercial'] },
  '022': { id: 'cimb', name: 'ซีไอเอ็มบี', color: '#7e2f36', clues: ['ซีไอเอ็มบี', 'cimb'] },
  '024': { id: 'uob', name: 'ยูโอบี', color: '#0b3b8c', clues: ['ยูโอบี', 'uob'] },
  '025': { id: 'bay', name: 'กรุงศรี', color: '#fec43b', clues: ['กรุงศรี', 'krungsri'] },
  '030': { id: 'gsb', name: 'ออมสิน', color: '#eb198d', clues: ['ออมสิน', 'mymo', 'gsb'] },
  '033': { id: 'ghb', name: 'อาคารสงเคราะห์', color: '#f57d23', clues: ['อาคารสงเคราะห์', 'ghb'] },
  '034': { id: 'baac', name: 'ธ.ก.ส.', color: '#4b9b3a', clues: ['ธ.ก.ส.', 'เพื่อการเกษตร', 'baac'] },
  '067': { id: 'tisco', name: 'ทิสโก้', color: '#12549f', clues: ['ทิสโก้', 'tisco'] },
  '069': { id: 'kkp', name: 'เกียรตินาคินภัทร', color: '#635f98', clues: ['เกียรตินาคิน', 'kkp'] },
  '073': { id: 'lhb', name: 'แลนด์ แอนด์ เฮ้าส์', color: '#6d6e71', clues: ['แลนด์ แอนด์ เฮ้าส์', 'lh bank'] },
};

export function bankByCode(code: string | null | undefined): BankInfo | null {
  return code ? BANKS[code] ?? null : null;
}

export function bankById(id: string | null | undefined): BankInfo | null {
  if (!id) return null;
  return Object.values(BANKS).find((b) => b.id === id) ?? null;
}

/** Guess the bank of the *sender* from the first lines that mention a bank. */
export function guessBankFromText(lines: string[]): BankInfo | null {
  for (const line of lines) {
    for (const bank of Object.values(BANKS)) {
      if (bank.clues.some((c) => (c.length <= 4 ? line.toLowerCase().includes(c) : fuzzyIncludes(line, c)))) return bank;
    }
  }
  return null;
}
