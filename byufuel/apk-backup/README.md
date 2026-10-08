# Byufuel APK backup

**Device:** Nothing A015 / Tetris (`00117648V003247`)  
**Package:** `com.byufuel.uat` (Driver / TSM UAT app)  
**Version:** `1.0.0` (versionCode 2)  
**Installed on device:** 2026-09-28  
**Dumped:** 2026-10-08 16:38

## Possible?

| What | Possible? |
|------|-----------|
| Save APK and reinstall later | **Yes** — done below |
| Restore login / app data | Usually **no** without root (backup often disabled) — you re-login after install |

## Restore (USB + adb, same or another device)
This app is a **split APK** — use `install-multiple` with **all** files:

```powershell
cd byufuel\apk-backup
adb install-multiple -r base.apk split_config.arm64_v8a.apk split_config.bn.apk split_config.en.apk split_config.gu.apk split_config.hi.apk split_config.kn.apk split_config.mr.apk split_config.ta.apk split_config.te.apk split_config.xxhdpi.apk
```

Or:
```powershell
adb install-multiple -r (Get-ChildItem byufuel\apk-backup\*.apk | ForEach-Object FullName)
```

## Note
Supplier app `com.byufuel.mobile` was **not** on this device (only `com.byufuel.uat`). Dump that separately when present.
