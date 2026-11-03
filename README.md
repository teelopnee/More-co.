# More-co.

## อ่าวสนธยา (`sunset-cove/`)

เกมแล่นเรือใบ 3 มิติบนเบราว์เซอร์ เน้นภาพสมจริง: ล่องเรือในอ่าวหน้าผายามเย็น เก็บลังและถังไม้ที่ลอยอยู่ 8 จุด แล้วนำกลับมาที่ท่าเรือก่อนฟ้ามืด (12 นาที)

A realistic browser sailing game built with three.js. Sail a pinnace around a cliff-lined bay at golden hour, recover 8 floating cargo clusters and bring them back to the pier before dark.

### Controls

| | Touch | Keyboard / mouse |
|---|---|---|
| Sail up / down (hold down to reverse) | Left stick up / down | `W` / `S` or `↑` / `↓` |
| Rudder | Left stick left / right | `A` / `D` or `←` / `→` |
| Orbit camera | Drag on the right side | Drag |
| Zoom | Pinch | Mouse wheel |
| Pause | ⏸ button | `Esc` / `P` |

Sailing downwind is fastest; heading into the wind drops speed sharply.

### What's in the scene

- **Sky and lighting**: a real photographed HDR panorama (`evening_road_01_puresky`) used as both the visible sky and image-based lighting, with a matching shadow-casting sun.
- **Ocean**: custom shader with 8 Gerstner waves, sky reflection with Fresnel, sun glitter, sub-surface tint on wave crests, see-through shallow water over the sand, and shoreline foam driven by a terrain height texture.
- **Island**: procedural heightfield (domain-warped noise, headlands, sea stacks) shaded with scanned sand, grass and rock textures (triplanar on cliffs), lined with photogrammetry cliff and rock models.
- **Ships and props**: scanned / hand-modelled CC0 models: the player's pinnace, an anchored galleon and fluyt, a wooden pier, a coastal fort, channel markers, crates and barrels.
- **Effects**: foam wake with Kelvin arms, bow spray, buoyancy from the same wave function, synthesized sea / wind audio.

### Run locally

The page is plain HTML plus an import map (three.js r170 from jsDelivr), so any static server works:

```bash
cd sunset-cove
python3 -m http.server 8000
# open http://localhost:8000/
```

### Asset format

Each model lives in `sunset-cove/assets/models/<name>/` as `<name>.json`: standard glTF JSON whose single geometry buffer is base64-packed into a `_bin` field, plus WebP textures referenced by relative path. The page rebuilds an in-memory GLB before handing it to `GLTFLoader`, so only plain web file types (`.json`, `.webp`, `.jpg`, `.txt`) are fetched. The HDR sky for lighting is base64 text in `sky_env.txt`.

### Credits

- 3D models, HDRI sky and PBR textures: [Poly Haven](https://polyhaven.com) (CC0). Models were simplified and their textures converted to WebP for the web.
- Water normal map: three.js examples.
- Rendering: [three.js](https://threejs.org) (MIT).
