# Desktop icon assets

이 디렉터리의 `icon.{png,ico,icns}` 와 `icons/{16,32,64,72,96,128}x{...}.png` 는
**자동 생성물**입니다. 손으로 편집하지 마세요.

생성 파이프라인:

```
icons/icon.png  (1024+ 권장 — 현재 1254×1254)
        │
        ▼
desktop/scripts/prepare-icons.mjs   (sharp + png2icons)
        │
        ├── icons/{16,32,64,72,96,128}x{...}.png   (트레이 / 멀티해상도용)
        ├── desktop/build/icon.png                  (Linux AppImage)
        ├── desktop/build/icon.ico                  (Windows NSIS, multi-res)
        ├── desktop/build/icon.icns                 (macOS DMG, multi-res)
        └── desktop/build/icons/{...}.png           (extraResources → 트레이)
```

`npm run prepare:icons` 또는 `npm run build` 시점에 재생성됩니다.
새 디자인을 반영하려면 `icons/icon.png` 만 갈아끼우면 됩니다.
