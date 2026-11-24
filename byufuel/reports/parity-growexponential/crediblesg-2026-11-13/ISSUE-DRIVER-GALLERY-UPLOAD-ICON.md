# BUG — Driver APK pickup **gallery upload** icon does not work

| | |
|--|--|
| **ID** | DRV-GALLERY-01 |
| **Verdict** | **BUG** |
| **Severity** | **Medium** (cannot attach existing photos; Capture-only workaround) |
| **Module** | Driver APK → itinerary pickup → container/photo step (Before/After) |
| **When** | 2026-11-18 |
| **Surface** | Driver mobile app (Byufuel UAT) |

## Summary

On the Driver pickup screen, the **upload from gallery** icon (next to **Capture**) does **not work** when tapped. Driver cannot pick an existing photo from the device gallery.

## Environments

| App | Notes |
|-----|--------|
| Driver UAT APK | Evidence: IT-000000338 · container `#B-2610-6-00109` · Pickup Before/After photo row |

## Steps to reproduce

1. Login Driver APK; open active itinerary (e.g. **IT-000000338**).
2. Open a stop pickup flow through **Scan / Containers / Documents** as applicable.
3. On the photo row (Before/After) next to **Capture**, tap the **gallery / upload** icon.
4. Observe result.

## Expected

- Gallery/upload icon opens device gallery (or photo picker) so driver can select an existing image for Before/After (or the intended attachment slot).

## Actual

- Gallery/upload icon **does not work** (no gallery / no picker / no action).
- **Capture** button is present; gallery path is broken.

## Impact

- Drivers must use live camera only; cannot re-use or attach gallery photos.
- Slows pickup when re-upload / offline-captured photos are needed.

## Evidence

| File | Notes |
|------|--------|
| `driver-pickup-gallery-upload-icon-not-working.png` | Gallery icon left of Capture · Before/After thumbs · Complete Pickup |

## Suggested fix

- Wire gallery icon to Android photo picker / storage permission + attach flow for Before/After (same payload as Capture).
- Disable or hide the icon if gallery is intentionally unsupported (prefer fix to match visible control).

## Tracker paste (short)

**Title:** [Driver APK] Gallery upload icon next to Capture not working on pickup  

**Body:**  
Driver pickup photo step — gallery/upload icon beside Capture does nothing (IT-000000338). BUG DRV-GALLERY-01. Evidence: `driver-pickup-gallery-upload-icon-not-working.png` (2026-11-18).
