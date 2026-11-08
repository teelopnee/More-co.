# More-co.

ทุกแอปและเอกสารอยู่ใน repo นี้ที่เดียว แก้จากแท็บเล็ต มือถือ หรือคอมก็ได้
ระบบจะทดสอบ รวมงาน และเผยแพร่ขึ้นเว็บให้เอง

**หน้ารวมทุกแอป:** https://teelopnee.github.io/More-co./

| แอป | เปิดใช้ | โฟลเดอร์ |
|---|---|---|
| จดไว — จดรายรับรายจ่ายจากสลิป | [/jodwai/](https://teelopnee.github.io/More-co./jodwai/) | [`apps/jodwai`](apps/jodwai) |
| อ่าวสนธยา — เกมแล่นเรือใบ 3 มิติ | [/sunset-cove/](https://teelopnee.github.io/More-co./sunset-cove/) | [`apps/sunset-cove`](apps/sunset-cove) |
| แปะไว้ — แปะทุกเรื่องที่ค้างในหัว (เปิดจากขอบจอแท็บเล็ต Samsung) | [/paewai/](https://teelopnee.github.io/More-co./paewai/) | [`apps/paewai`](apps/paewai) |

| เอกสาร | |
|---|---|
| [PROJECT: ODD-SPACE — GDD](docs/odd-space-gdd.md) | ฉบับหลักที่แก้ต่อได้ (ไฟล์ .docx เดิมเก็บไว้ใน [`docs/originals/`](docs/originals)) |

## ทำงานอัตโนมัติยังไง

```
สั่ง Claude จากเครื่องไหนก็ได้ → Claude ส่งงานขึ้น branch claude/…
  → GitHub Actions ติดตั้ง ทดสอบ และ build ทุกแอป
  → ผ่าน   : รวมเข้า main ให้เอง แล้วเผยแพร่ขึ้นเว็บ (ราว 2–3 นาที)
  → ไม่ผ่าน : ไม่รวม เว็บยังเป็นเวอร์ชันเดิม ดูสาเหตุได้ในแท็บ Actions
```

- แก้ตรงบน `main` เอง (github.dev, Codespaces) ก็ทดสอบและเผยแพร่ให้เหมือนกัน
- ระบบจะหยุดรวมและขึ้น ❌ ในแท็บ Actions พร้อมลิงก์เปิด PR เมื่อ
  - งานแก้ไฟล์เดียวกันชนกับงานอื่นที่เพิ่งเข้า `main`
  - รวมกับ `main` แล้วทดสอบไม่ผ่าน
  - งานแก้ไฟล์ใน `.github/workflows/` (GitHub ไม่ให้ระบบอัตโนมัติแก้ไฟล์กลุ่มนี้ เว้นแต่ตั้ง `AUTOMERGE_TOKEN` ด้านล่าง)

## ตั้งค่าครั้งแรก (ทำครั้งเดียว)

1. ให้มี branch `main` (สร้างจาก branch ล่าสุดที่มีไฟล์นี้: หน้า repo → Branches → New branch)
2. **Settings → General → Default branch** → เลือก `main`
3. **Settings → Pages → Build and deployment → Source** → เลือก **GitHub Actions**
4. **Actions → Build, test & publish → Run workflow** → เลือก `main`

ถ้าขั้นเผยแพร่ขึ้นว่า `Branch "main" is not allowed to deploy to github-pages`
ให้ไปที่ **Settings → Environments → github-pages** แล้วเพิ่ม `main` ในรายการ branch ที่อนุญาต

## ปรับได้

- **ปิดการรวมอัตโนมัติ** (อยากกด merge เองทุกครั้ง): Settings → Secrets and variables → Actions → **Variables** → เพิ่ม `AUTO_MERGE` = `off`
- **ให้รวมเองได้ทุกกรณี แม้งานแก้ไฟล์ workflow**: สร้าง [fine-grained token](https://github.com/settings/personal-access-tokens/new) เฉพาะ repo นี้ ให้สิทธิ์ *Contents* และ *Workflows* แบบ Read and write
  แล้วเพิ่มเป็น **Secret** ชื่อ `AUTOMERGE_TOKEN`

## เพิ่มแอปใหม่

สร้างโฟลเดอร์ `apps/<ชื่อ>/` แค่นั้น ระบบจะเจอแอปเอง ใส่ลงหน้ารวม และเผยแพร่ที่ `/More-co./<ชื่อ>/`

- **มี `package.json`**: ระบบรัน `npm ci` → `npm test` (ถ้ามี) → `npm run build` แล้วเอา `dist/` ขึ้นเว็บ (ถ้าใช้ Vite ให้ตั้ง `base: './'`)
- **ไม่มี `package.json`**: เอาไฟล์ทั้งโฟลเดอร์ขึ้นเว็บตรง ๆ (HTML/JS ล้วน)
- ชื่อและคำอธิบายบนหน้ารวมมาจากหัวข้อแรกและย่อหน้าแรกของ `README.md` ในโฟลเดอร์
  หรือกำหนดเองใน `app.json`: `{ "title": "…", "description": "…", "icon": "icons/icon-192.png", "output": "dist" }`
- ใช้ path แบบ relative เสมอ (`assets/x.png` ไม่ใช่ `/assets/x.png`) เพราะแต่ละแอปอยู่ในโฟลเดอร์ย่อยของเว็บ

## แก้งานจากเครื่องไหนก็ได้

ทุกวิธีด้านล่างอ่านและเขียนที่ GitHub ที่เดียวกัน เปลี่ยนเครื่องแล้วทำต่อได้ทันที

| อยากทำอะไร | ใช้อะไร |
|---|---|
| สั่ง AI สร้างหรือแก้แอป | Claude Code ที่ [claude.ai/code](https://claude.ai/code) หรือในแอป Claude |
| แก้โค้ดเอง มี terminal รันดูผลได้ | GitHub Codespaces (VS Code ในเบราว์เซอร์ ใช้บนแท็บเล็ตได้) |
| แก้ไฟล์เล็กน้อยแบบเร็ว ๆ | เปิดหน้า repo แล้วกด `.` จะเข้า github.dev |
| ดูว่าเผยแพร่เสร็จหรือยัง | แท็บ Actions ในแอป GitHub |

## รันในเครื่อง

```bash
node scripts/build-site.mjs
```

```bash
node scripts/build-site.mjs --skip-tests --only=jodwai
```

ผลลัพธ์อยู่ใน `_site/` เปิดดูได้ด้วย static server ใดก็ได้ เช่น `python3 -m http.server -d _site`
ถ้าจะทำงานกับแอปเดียว ให้เข้าไปในโฟลเดอร์ของแอปนั้นแล้วดู README ของแอป
