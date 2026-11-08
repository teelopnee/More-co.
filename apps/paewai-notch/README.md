# แปะไว้ ที่ notch — แอป Android

แถบดำครอบกล้องด้านบนจอ Galaxy Tab S Ultra แตะหรือปัดลงแล้วช่องแปะเลื่อนลงมาจาก notch ทับทุกแอป พิมพ์ กด Enter ตัวเลขบนแถบคือเรื่องที่ต้องทำวันนี้ ถึงเวลาแถบขยายเตือน

**ดาวน์โหลด:** https://teelopnee.github.io/More-co./paewai-notch/ (เปิดบนแท็บเล็ต แล้วทำตามขั้นตอนในหน้านั้น)

เป็นแอปพี่น้องของ [แปะไว้ฉบับเว็บ](../paewai) ใช้หน้าจอและโค้ดชุดเดียวกัน (`../paewai/src` ถูกใส่ใน APK)
แต่เว็บวาดทับแอปอื่นหรือทับแถบสถานะไม่ได้ จึงต้องมีส่วน Android มาช่วย

## ทำงานยังไง

| ส่วน | หน้าที่ |
|---|---|
| `NotchService` | Accessibility service ที่มีไว้วางหน้าต่างเล็ก ๆ ทับแถบสถานะตรงกล้อง (`TYPE_ACCESSIBILITY_OVERLAY`) ไม่อ่านอะไรบนจอ (`canRetrieveWindowContent="false"`) หมุนจอแล้วย้ายตามกล้อง ซ่อนเมื่อแอปเต็มจอ |
| `PillGeometry` | คำนวณตำแหน่ง/ขนาดแถบจากกรอบ display cutout (บน, ซ้าย, ขวา หรือไม่มี notch) มี unit test |
| `PillView` | วาดแถบ: ไอคอนโน้ตซ้ายกล้อง ตัวเลข/เวลาโฟกัสขวากล้อง ขยายลงมาแสดงข้อความตอนเตือน |
| `PanelActivity` | การ์ดที่เลื่อนลงมาจาก notch (WebView โหมด `?mode=panel`) ปิดแล้วซ่อนไว้เบื้องหลัง เปิดครั้งต่อไปทันที รับข้อความที่แชร์มาจากแอปอื่น |
| `MainActivity` | แปะไว้เต็มจอ (งาน โน้ต โฟกัส ตั้งค่า) |
| `WebHost`, `Bridge` | เปิดเว็บจาก assets ที่ `https://appassets.androidplatform.net` และ `window.PaewaiAndroid` ให้เว็บสั่ง Android |
| `RecorderService` | อัดเสียงเป็น foreground service (ไมโครโฟน) อัดต่อได้แม้ปิดจอหรือใช้แอปอื่น AAC .m4a แบ่งไฟล์ทุก ~25 นาที การแจ้งเตือนมีปุ่มพัก/หยุด แถบที่ notch เป็นจุดแดงพร้อมเวลา หน้าเว็บอ่านไฟล์ผ่าน `/rec/<id>/<n>.m4a` |
| `RecordActivity`, `RecordTile` | "อัดเสียง แปะไว้": ไอคอนแยกในลิ้นชักแอป (ตั้งเป็นปุ่มด้านข้างกดสองครั้งได้), ทางลัดกดค้างที่ไอคอน และปุ่มในแผงด่วน แตะ = เริ่ม แตะอีกครั้ง = หยุด |
| `Reminders`, `ReminderReceiver`, `BootReceiver` | ปลุกจริงด้วย AlarmManager เมื่อถึงเวลางานหรือครบเวลาโฟกัส แม้ปิดแอป แจ้งเตือนมีปุ่ม *เลื่อน 10 นาที* / *เสร็จแล้ว* (เปิดการ์ดแล้วสั่งหน้าเว็บผ่าน `paewai.snooze()` / `paewai.done()`) |

ทั้งการ์ดและแอปเต็มใช้ origin เดียวกัน ข้อมูล (localStorage) จึงเป็นชุดเดียวกัน แต่แยกจากเว็บใน Chrome
ซิงก์ข้ามเครื่อง (GitHub ส่วนตัว) และถาม Claude ทำงานในแอปนี้เหมือนฉบับเว็บ เพราะเป็นโค้ดชุดเดียวกัน
ตั้งซิงก์ในแอปนี้แยกจากเว็บ (⋮ → ซิงก์ข้ามเครื่อง → วางโค้ดจากเครื่องที่เชื่อมแล้ว)

## สร้าง

```bash
npm test         # สัญญาระหว่าง app.js กับ Bridge.java, manifest, หน้าดาวน์โหลด
npm run build    # ใส่เว็บลง assets → Gradle (unit test + assembleRelease) → dist/paewai-notch.apk + หน้าดาวน์โหลด
```

ต้องมี Java 17+ และ Android SDK (`ANDROID_HOME`) ซึ่ง GitHub Actions (ubuntu) มีให้แล้ว
ในเครื่องที่ไม่มี SDK จะสร้างแค่หน้าดาวน์โหลดโดยไม่มี APK · `PAEWAI_GRADLE=/path/to/gradle` ใช้ Gradle ที่มีอยู่แทน wrapper

**กุญแจเซ็น APK** ไม่อยู่ใน repo (repo นี้เป็นสาธารณะ) build จะอ่านจาก GitHub Secrets:
`PAEWAI_KEYSTORE_B64` (ไฟล์ .p12 แบบ base64) และ `PAEWAI_KEYSTORE_PASSWORD` (ตั้ง `PAEWAI_KEY_ALIAS` ได้ ค่าเริ่มต้น `paewai`)
ถ้าไม่มี จะได้ APK รุ่นทดลองที่เซ็นด้วยกุญแจ debug ซึ่งเปลี่ยนทุกครั้งที่สร้าง ติดตั้งทับรุ่นก่อนไม่ได้
(ต้องสำรองข้อมูล ลบแอป แล้วติดตั้งใหม่) และ workflow ต้องส่ง secret สองตัวนี้ให้ขั้น `node scripts/build-site.mjs`
