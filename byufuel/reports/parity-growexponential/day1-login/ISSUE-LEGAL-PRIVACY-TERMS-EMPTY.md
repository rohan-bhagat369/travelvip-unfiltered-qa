# FAIL_GROW — Privacy Policy & Terms pages empty on Grow (“No content has been published yet”)

| | |
|--|--|
| **ID** | UI-LEGAL-01 (Privacy) · UI-LEGAL-02 (Terms) |
| **Verdict** | **FAIL_GROW** |
| **Severity** | **High** (legal / compliance pages blank for end users) |
| **Module** | Admin Web → footer **Privacy Policy** / **Terms** |
| **When** | 2026-11-04 |
| **Rule** | Azure = baseline. Grow differs → FAIL_GROW |

## Summary

Clicking footer **Privacy Policy** or **Terms** on Grow opens pages that show only **“No content has been published yet.”**  
On Azure, Privacy Policy shows full published legal content; Terms opens the Terms & Conditions settings page with heading content (not the empty CMS stub).

Also note **URL path mismatch** (Grow short routes vs Azure settings routes).

## Environments

| Env | Privacy URL | Terms URL |
|-----|-------------|-----------|
| **Grow (bug)** | `https://uat-byufuel.growexponential.app/policy` | `https://uat-byufuel.growexponential.app/terms` |
| **Azure (baseline)** | `https://u-byufuel.azurewebsites.net/settings/terms-privacy/privacy-policy` | `https://u-byufuel.azurewebsites.net/settings/terms-privacy/terms-conditions` |

Admin: Amaan Khan. Footer links used on both apps.

## Steps to reproduce

1. Login Admin on Grow and Azure.
2. From any page footer, click **Privacy Policy**.
3. Observe page body.
4. Click footer **Terms** (or navigate Terms from Privacy footer).
5. Observe page body.

## Expected (Azure)

| Page | Result |
|------|--------|
| Privacy Policy | Title **Privacy Policy** + full body (Interpretation, Definitions, Collecting and Using Your Personal Data, Company = Byufuel India Private Limited, etc.) |
| Terms and Conditions | Terms page loads under settings (heading **TERMS AND CONDITIONIS** visible — not an empty “not published” stub) |

## Actual (Grow)

| Page | Result |
|------|--------|
| `/policy` | Light box: **No content has been published yet.** Rest of page blank. |
| `/terms` | Same: **No content has been published yet.** |

## Impact

- Users / partners cannot read Privacy or Terms on Grow UAT.
- Looks like **CMS / content publish** not done on Grow (or wrong content source / tenant), not only a copy tweak.
- Compliance / onboarding risk if Grow is treated as production-like UAT.

## Evidence

| Case | Grow | Azure |
|------|------|-------|
| Privacy | `legal-privacy-GROW.png` | `legal-privacy-AZURE.png` |
| Terms | `legal-terms-GROW.png` | `legal-terms-AZURE.png` |

## Suggested fix

1. Publish Privacy Policy + Terms content for Grow tenant/CMS (same source of truth as Azure if shared).
2. Align footer deep-links if routes should match Azure (`/settings/terms-privacy/...`) or ensure `/policy` and `/terms` resolve published content.
3. Re-test footer links after publish — empty stub must not show when content exists.

## Related

- UI-CS-01 search placeholder · UI-CS-02 contact icon (same Grow parity pass).

## Tracker paste (short)

**Title:** [Grow] Privacy Policy & Terms show “No content has been published yet” vs Azure  

**Body:**  
Footer Privacy Policy (`/policy`) and Terms (`/terms`) on Grow UAT render empty CMS stub. Azure Privacy has full legal text; Azure Terms page loads under `/settings/terms-privacy/...`. FAIL_GROW UI-LEGAL-01/02. Evidence: 4 screenshots 2026-11-04.
