# PROJECT: ODD-SPACE (100% AI-DRIVEN MASTER GDD v3.0)

> คัมภีร์สร้างเกมด้วย AI 100%: รวมเครื่องมือ AI ทุกมิติ สไปรท์ 2D, โมเดล 3D, เสียง, GDScript โค้ด และระบบเกม
>
> Target Platform: Samsung Galaxy Tab S12 Ultra (100% Cloud & Mobile AI Pipeline) | Engine: Godot Engine 4 HD-2D

## 1. วิสัยทัศน์และการสร้างเกมด้วย AI 100% (100% AI-Driven Development Vision)

**วิสัยทัศน์การพัฒนา:** ในโปรเจกต์ PROJECT: ODD-SPACE การพัฒนาทั้งหมดตั้งแต่ภาพ 2D, โมเดล 3D, เสียงดนตรี, เสียงพากย์, บทสนทนา, ไปจนถึงการเขียนโค้ด GDScript ใน Godot Engine 4 จะถูกเน้นการสร้างผ่านเทคโนโลยี Generative AI 100% โดยมีผู้พัฒนาทำหน้าที่เป็น 'AI Director & Systems Integrator' บนแท็บเล็ต Samsung Galaxy Tab S12 Ultra

> **🤖 3 เสาหลักของการสร้างเกมด้วย AI 100%**
>
> 1. No Manual Drawing & 3D Sculpting Needed: ไม่ต้องวาดภาพเองเฟรมต่อเฟรม หรือนั่งปั้น 3D หลายสัปดาห์ ใช้ AI เจนสไปรท์และโมเดล 3D ตรงเข้าเครื่อง
> 2. Cloud-Based Mobile Workflow: รัน AI Tools ผ่านเว็บเบราว์เซอร์บน Tab S12 Ultra (Scenario, Meshy, Tripo3D, Midjourney) แล้วดาวน์โหลดไฟล์ (.gltf, .png, .wav) เข้า Godot Android
> 3. Infinite Emergent Content: ใช้อัลกอริทึม Generative AI ในการสร้างบทสนทนา โลกสุ่ม และเครือข่ายเหตุผลแบบไร้ขีดจำกัด

## 2. ผังเครื่องมือ AI สำหรับแต่ละส่วนงาน (100% AI Asset Generation Stack)

ตารางรวมแอปพลิเคชันและเว็บ AI ที่ใช้แทนการทำงานด้วยมือทุกขั้นตอน:

| **หมวดงาน**                           | **เครื่องมือ AI หลัก**                   | **ผลลัพธ์ที่ได้ (Output)**                                    | **ขั้นตอนการนำไปใช้ใน Godot**                          |
|---------------------------------------|--------------------------------------|----------------------------------------------------------|-----------------------------------------------------|
| **2D Character Sprites & Animations** | Scenario.gg / PixelLab.ai / EbSynth  | Sprite Sheets 2D (Walk, Run, Attack, Parry) พื้นหลังใส .png | นำเข้า Godot ตั้งเป็น AnimatedSprite3D (Billboard Mode) |
| **3D Environment & Props**            | Meshy.ai / Tripo3D / Rodin AI        | ไฟล์โมเดล 3D (.gltf / .obj) มี Decimation ในตัวพร้อม Texture | นำเข้าฉาก 3D ใน Godot ตั้งค่า Lighting และ Shadows      |
| **Concept Art & UI Decals**           | Flux.1 / Midjourney v6 / DALL-E 3    | ภาพฉากบรรยากาศ ป้ายโฆษณานีออน ไอคอน UI .png                | แปรรูปเป็น 3D Decals และ HUD Overlays บนหน้าจอเกม      |
| **Music & Ambient Audio**             | Suno AI v3.5 / Udio                  | เพลงประกอบ Synthwave / Retro-Futurism (.mp3 / .wav)      | ใส่ใน AudioStreamPlayer3D สำหรับเพลงฉากและดนตรีต่อสู้     |
| **SFX & Character Voice**             | ElevenLabs / Soundraw / Stable Audio | เสียงพากย์ตลกร้าย และเสียงเอฟเฟกต์ยิงเลเซอร์, Parry (.wav)      | ผูกกับอนิเมชันกระทำผ่าน GDScript Audio Triggers          |
| **Code, Logic & Narrative**           | Gemini 1.5 Pro / Claude 3.5 Sonnet   | สคริปต์ GDScript, JSON DB, Dialogue Trees, Causality Nodes | ก๊อปปี้โค้ดวางใน Script Editor ของ Godot Android โดยตรง |

## 3. เวิร์กโฟลว์สร้างอนิเมชัน 2D พิกเซลด้วย AI 100% (2D AI Animation Pipeline)

ขั้นตอนการเจนสไปรท์และการทำอนิเมชัน 2D โดยไม่ต้องวาดเองแม้แต่เฟรมเดียว:

- **ขั้นตอนที่ 1 (Character Generation):** ป้อน Prompt ภาษาอังกฤษสร้างตัวละคร 2D Pixel Style (เช่น 32-bit Space Bounty Hunter) ใน Scenario.gg หรือ PixelLab.ai เพื่อให้ได้สไตล์ที่ต้องการ

- **ขั้นตอนที่ 2 (Animation Generation):** ใช้ฟีเจอร์ Sprite Sheet Generator หรือ Motion LoRA ใน Scenario.gg เพื่อสร้างท่าทางเคลื่อนไหว 8 ทิศทาง (Idle, Walk, Attack, Parry, Dodge Roll)

- **ขั้นตอนที่ 3 (Video-to-Pixel Animation):** หากต้องการอนิเมชันที่พลิ้วไหวสูง สามารถใช้วิดีโอคนแสดงจริง (Video-to-Video) แล้วผ่าน EbSynth หรือ PixelLab เพื่อเปลี่ยนเป็นสไปรท์พิกเซลแบบอัตโนมัติ

- **ขั้นตอนที่ 4 (Engine Import):** ลบพื้นหลังด้วย AI BG Remover แล้วดึงไฟล์ PNG Sprite Sheet เข้าสู่ Godot Engine 4 บนแท็บเล็ต

## 4. เวิร์กโฟลว์สร้างโมเดล 3D ด้วย AI 100% (3D AI Generation Pipeline)

ขั้นตอนการเปลี่ยนคำอธิบายหรือภาพถ่ายเป็นโมเดล 3D พร้อมใช้งานในเกม:

- **ขั้นตอนที่ 1 (Text-to-3D Generation):** ป้อนคำสั่ง Text-to-3D ใน Meshy.ai หรือ Tripo3D เช่น 'Low-poly retro sci-fi space vending machine, glowing neon lights, 80s aesthetics'

- **ขั้นตอนที่ 2 (Image-to-3D Conversion):** หรือเจนภาพ 2D ด้วย Midjourney ก่อน แล้วนำภาพนั้นไปอัปโหลดใส่ Image-to-3D ใน Meshy.ai เพื่อให้ได้โมเดล 3D ทรงเป๊ะตรงตาม Concept Art

- **ขั้นตอนที่ 3 (Auto-Optimization):** เปิดโหมด Auto-Remesh / Decimation ในแอป AI ให้โมเดลมีจำนวน Polygon ไม่เกิน 5,000 - 15,000 Tris พร้อมสร้าง PBR Textures (Albedo, Roughness, Emission) ในตัว

- **ขั้นตอนที่ 4 (Direct Import):** ดาวน์โหลดไฟล์ .gltf เข้า Tab S12 Ultra แล้วลากวางลงในฉาก 3D ของ Godot Engine ได้ทันที

## 5. เวิร์กโฟลว์เสียงดนตรี เอฟเฟกต์ และเสียงพากย์ด้วย AI (AI Audio Pipeline)

- **เพลงประกอบ (Background Music):** ป้อน Prompt ใน Suno AI v3.5 เช่น 'Dark synthwave, retro 80s space exploration, eerie synth lead, heavy bass, sci-fi atmosphere, instrumental' ได้เพลงประกอบระดับสตูดิโอใน 30 วินาที

- **เสียงพากย์ (Voice Acting):** ใช้ ElevenLabs สร้างเสียงพากย์บทสนทนา NPC สไตล์ตลกร้าย เสียดสี ปรับน้ำเสียงและอารมณ์ประชดประชันได้ตามต้องการ

- **เอฟเฟกต์เสียง (SFX):** ใช้ ElevenLabs Sound Effects หรือ Soundraw เจนเสียงยิงเลเซอร์, เสียง Parry กระสุน, เสียงประตูยานเปิด

## 6. คลัง Prompts คำสั่ง AI ระดับมาสเตอร์ (Master AI Prompt Library)

คอลเลกชันคำสั่ง Prompt สำหรับคัดลอกไปใช้ใน AI แต่ละแอปพลิเคชันได้ทันที:

> **🤖 Complete AI Prompt Templates for PROJECT: ODD-SPACE**
>
> 1. Midjourney v6 / Flux.1 (Concept Art & Environment Ref):
> "HD-2D style video game screenshot of a retro-futuristic sci-fi space station slum, 80s cyberpunk style, vibrant neon signs in pastel orange and purple, octane render, tilt-shift lens effect, depth of field, Octopath Traveler style 2.5D view, high detailed pixel character in space suit standing under neon sign --ar 16:9 --v 6.0"
>
> 2. Scenario.gg / PixelLab (2D Sprite Sheet Generation):
> "Full body 2D pixel art sprite sheet of a sci-fi space bounty hunter, 32-bit style, multiple animation frames: idle pose, running cycle, laser rifle shooting, parry stance, dodge roll animation, transparent background, clean pixel art, Katana Zero aesthetics --ar 16:9"
>
> 3. Meshy.ai / Tripo3D (Text-to-3D Props Model):
> "Low-poly 3D prop model of a chunky retro 80s sci-fi computer terminal with glowing neon monitor, cybernetics cables, game ready asset, PBR textures, clean topology"
>
> 4. Suno AI v3.5 (Background Music Prompt):
> "Dark synthwave, retro 80s space exploration, eerie synth leads, pulse bassline, cyberpunk atmosphere, cinematic sci-fi, dynamic battle music, instrumental"

## 7. โครงสร้างเกมหลักและระบบเครือข่ายเหตุผล (Game Core & Causality System)

สรุปโครงสร้างเกมและระบบ Causality Engine ที่ขยายความจากเอกสารเดิม:

**[Causality Node Data Structure Scheme]**

```json
{
  "node_id": "NODE_0482_AI_GENERATED",
  "timestamp_game_time": 1042.5,
  "cause_nodes": [
    "NODE_0012_BACKGROUND_ACCOUNTANT",
    "NODE_0210_STOLE_MEDS"
  ],
  "action_type": "FACTION_DISRUPTION",
  "actor": "PLAYER",
  "target_entity": "BIOTECH_CORP_WAREHOUSE_A",
  "location": {
    "planet_id": "PLANET_X9",
    "zone": "SECTOR_04"
  },
  "direct_outcomes": {
    "biotech_rep_change": -25,
    "local_market_med_price_mult": 3.5,
    "flag_set": [
      "MED_SHORTAGE_PLANET_X9",
      "PLAYER_WANTED_BIOTECH"
    ]
  },
  "propagation_radius": "SECTOR_WIDE",
  "knowledge_spread_delay_hours": 12.0
}
```

- **Deep Dynamic Origin:** ผู้เล่นผสมผสาน Background Tag, Motivation Tag และ Secret/Flaw Tag เองตั้งแต่เริ่มต้น โดยไม่มีอาชีพบังคับ

- **Causality Graph Engine:** ทุกการกระทำจดจำและเชื่อมโยงเป็นโหนด (Nodes) ข่าวสารกระจายผ่านยาน/ดาวเทียม ไม่มีสุ่มลอยๆ

- **HD-2D Fast Combat:** สไปรท์ 2D วิ่งในฉาก 3D มี Parry, Dodge Roll และระบบยิงเจาะเฉพาะจุด (Subsystem Targeting)

## 8. ข้อแนะนำการปฏิบัติงานสำหรับเอไอ (AI Execution Protocol)

> **📌 Protocol for AI Agent Collaboration**
>
> เมื่อ AI Agents (รวมถึง Gemini, Claude, ChatGPT) อ่านเอกสารฉบับนี้ ให้ดำเนินการสวมบทบาทตามที่กำหนด:
> - AI Game Master: เจนบทสนทนาและเควสต์สุ่มตาม Causality Node Graph
> - AI Code Generator: เขียนโค้ด Godot 4 GDScript ที่จัดการระบบ Node Graph, Sprite Animation และ Vulkan Shader
> - AI Visual & Audio Director: เจน Prompts และ Asset Specifications ให้ตรงตามโทน Retro-Futurism 80s เสียดสีทุนนิยม
