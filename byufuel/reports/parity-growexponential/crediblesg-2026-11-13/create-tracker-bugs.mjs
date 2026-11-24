/**
 * Playwright helper body for creating Byufuel bugs on Tracker.
 * Invoked via MCP browser_run_code_unsafe with page arg.
 */
export async function createBugs(page) {
  const bugs = [
    {
      id: 'UI-PAY-01',
      title: '[Grow] Supplier Payment Pay shows only Cash — missing UPI/Card/Others vs Azure',
      description: `**ID:** UI-PAY-01 · FAIL_GROW · High

Admin → Supplier Payment → Pay on Grow shows only **Cash**. Azure shows **Cash · UPI · Card · Others**.

**Grow:** https://uat-byufuel.crediblesg.com/byu/supplier-payment · build 1.0.0 (20260922.1)
**Azure:** https://u-byufuel.azurewebsites.net/byu/supplier-payment · build 1.0.0 (20261014.1)

**Steps:**
1. Login Admin on Grow + Azure
2. Open Supplier Payment → VERIFIED payment View
3. Click Pay
4. Compare payment method menu

**Expected:** Cash · UPI · Card · Others
**Actual (Grow):** Cash only

Evidence: supplier-payment-Pay-detail-Cash-only-GROW.png · supplier-payment-Pay-detail-menu-AZURE.png
Draft: ISSUE-SUPPLIER-PAYMENT-PAY-BUTTON.md`,
    },
    {
      id: 'SUP-NOTIF-01',
      title: '[Supplier APK] Payment Credited notification not received after Admin credits payment',
      description: `**ID:** SUP-NOTIF-01 · BUG · High

After Admin Supplier Payment → **CREDITED**, Supplier APK does not get **Payment Credited** notification.

**Expected:** Centvis TC 39 prior PASS — Notifications “Payment Credited SCH-640”
**Actual:** Not received after payment credited

**Steps:**
1. Open Supplier APK Notifications
2. Admin credits a VERIFIED payment for that supplier
3. Check Supplier notif tray + in-app list

Draft: ISSUE-SUPPLIER-APK-PAYMENT-CREDITED-NOTIF.md`,
    },
    {
      id: 'DRV-POPUP-01',
      title: '[Driver APK] Pickup Started popup shown after Pickup Completed',
      description: `**ID:** DRV-POPUP-01 · BUG · Medium

After completing pickup, Driver UAT still shows modal “Pickup Started — please complete the pickup” while stop status is **Pickup Completed**.

**Evidence:** IT-000000338 / SCH-000001823
driver-pickup-completed-still-Pickup-Started-popup.png

Draft: ISSUE-DRIVER-PICKUP-STARTED-POPUP-AFTER-COMPLETE.md`,
    },
    {
      id: 'DRV-GALLERY-01',
      title: '[Driver APK] Gallery upload icon next to Capture not working on pickup',
      description: `**ID:** DRV-GALLERY-01 · BUG · Medium

Driver pickup photo step — gallery/upload icon beside **Capture** does nothing (IT-000000338).

**Expected:** Opens gallery / photo picker
**Actual:** Icon does not work

Evidence: driver-pickup-gallery-upload-icon-not-working.png
Draft: ISSUE-DRIVER-GALLERY-UPLOAD-ICON.md`,
    },
    {
      id: 'DRV-CAP-01',
      title: '[Driver APK] Capacity: nullKg when selecting random container on pickup',
      description: `**ID:** DRV-CAP-01 · BUG · High

Pickup container quantity modal shows **Capacity: nullKg** after selecting a random container (IT-000000338 / #B-2610-6-00115).

**Expected:** Real capacity (e.g. 100 Kg)
**Actual:** Capacity: nullKg

Evidence: driver-pickup-capacity-nullKg.png
Draft: ISSUE-DRIVER-CAPACITY-NULL-KG.md`,
    },
  ];

  const created = [];

  for (const bug of bugs) {
    await page.goto(
      'https://tracker.travelvip.ai/tasks?teamId=74e16e07-1837-4a50-ad2b-e7c9f7e0a755&status=triage&projectId=66fb6eae-0ab9-4217-b398-67e8a269c336',
    );
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'New task' }).click();
    await page.waitForTimeout(800);

    await page.getByPlaceholder('Task title').fill(bug.title);
    await page.getByPlaceholder('Add description…').fill(bug.description);

    // Status → Triage
    const statusBtn = page.getByRole('button', { name: /Backlog|Triage|Todo/i }).first();
    await statusBtn.click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^Triage Triage$/ }).click().catch(async () => {
      await page.getByRole('button', { name: /Triage/ }).first().click();
    });
    await page.waitForTimeout(300);

    // Priority High
    await page.getByRole('button', { name: /No priority|High|Medium|Low|Urgent/i }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /^High High$/ }).click().catch(async () => {
      await page.getByRole('button', { name: /^High$/ }).click();
    });
    await page.waitForTimeout(200);

    // Assignee Mayur (may already stick)
    const assignee = page.getByRole('button', { name: /Assignees|Mayur More/i }).first();
    const assigneeText = await assignee.textContent();
    if (!/Mayur/i.test(assigneeText || '')) {
      await assignee.click();
      await page.getByPlaceholder('Search people…').fill('Mayur');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /^Mayur More/ }).click();
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
    }

    // Project ByuFuel
    const proj = page.getByRole('button', { name: /^Project$|^ByuFuel$/ }).first();
    const projText = await proj.textContent();
    if (!/ByuFuel/i.test(projText || '')) {
      await proj.click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: /^ByuFuel$/ }).click();
      await page.waitForTimeout(200);
    }

    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2500);

    // Find created task key via search
    await page.goto(
      `https://tracker.travelvip.ai/tasks?teamId=74e16e07-1837-4a50-ad2b-e7c9f7e0a755&projectId=66fb6eae-0ab9-4217-b398-67e8a269c336&q=${encodeURIComponent(bug.id)}`,
    );
    // title search may miss id — search unique title fragment
    await page.goto(
      `https://tracker.travelvip.ai/tasks?teamId=74e16e07-1837-4a50-ad2b-e7c9f7e0a755&projectId=66fb6eae-0ab9-4217-b398-67e8a269c336&q=${encodeURIComponent(bug.title.slice(0, 40))}`,
    );
    await page.waitForTimeout(1500);
    const link = page.locator('a[href*="/tasks/ENG-"]').filter({ hasText: bug.title.slice(0, 30) }).first();
    let key = null;
    if (await link.count()) {
      const href = await link.getAttribute('href');
      key = (href || '').match(/ENG-\d+/)?.[0] || null;
    }
    created.push({ id: bug.id, key, title: bug.title });
  }

  return created;
}
