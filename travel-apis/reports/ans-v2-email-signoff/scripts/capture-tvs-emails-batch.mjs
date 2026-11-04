// Playwright MCP browser_run_code_unsafe helper — TVS email evidence batch
async (page) => {
  const base =
    "travel-apis/reports/ans-v2-email-signoff/notif-evidence";
  const bookings = [
    {
      id: "FB1793702354303940",
      userAction: "confirmed",
      adminAction: "confirmed",
      csAction: "ticketed",
    },
    {
      id: "TX1793703354530386",
      userAction: "request-submitted",
      adminAction: "request-submitted",
      csAction: "request-submitted",
    },
    {
      id: "TX1793691173946414",
      userAction: "request-submitted",
      adminAction: "request-submitted",
      csAction: "request-submitted",
    },
    {
      id: "BB1793694549715997",
      userAction: "confirmed",
      adminAction: "confirmed",
      csAction: "confirmed",
    },
    {
      id: "BB1793694073375891",
      userAction: "confirmed",
      adminAction: "confirmed",
      csAction: "confirmed",
    },
    {
      id: "BR1793693827617960",
      userAction: "confirmed",
      adminAction: "confirmed",
      csAction: "confirmed",
    },
    {
      id: "BR1793693683463272",
      userAction: "confirmed",
      adminAction: "confirmed",
      csAction: "confirmed",
    },
    {
      id: "SR1793693247905420",
      userAction: "request-submitted",
      adminAction: "request-submitted",
      csAction: "request-submitted",
    },
    {
      id: "SR1793692744169322",
      userAction: "request-submitted",
      adminAction: "request-submitted",
      csAction: "request-submitted",
    },
    {
      id: "SR1793691405272102",
      userAction: "request-submitted",
      adminAction: "request-submitted",
      csAction: "request-submitted",
    },
  ];

  const shot = async (p, relPath) => {
    await p.waitForTimeout(1500);
    await p.screenshot({
      path: `${base}/${relPath}`,
      fullPage: true,
      scale: "css",
      type: "png",
    });
  };

  const openAdminCs = async (p, bookingId, adminAction, csAction) => {
    const folder = `${bookingId}/email`;
    await p.goto(`https://mail.google.com/mail/u/1/#search/${bookingId}`, {
      waitUntil: "domcontentloaded",
    });
    await p.waitForTimeout(2500);

    const adminLink = p
      .getByRole("link")
      .filter({ hasText: bookingId })
      .filter({ hasText: "[DEV] TravelVerse" })
      .filter({ hasNotText: "CSV2" })
      .first();
    await adminLink.click();
    await shot(p, `${folder}/admin-${adminAction}.png`);

    await p.goto(`https://mail.google.com/mail/u/1/#search/${bookingId}`, {
      waitUntil: "domcontentloaded",
    });
    await p.waitForTimeout(2000);

    const csLink = p
      .getByRole("link")
      .filter({ hasText: bookingId })
      .filter({ hasText: "CSV2 TravelVerse" })
      .first();
    await csLink.click();
    await shot(p, `${folder}/cs-${csAction}.png`);

    return {
      adminTitle: await p.title(),
      csTitle: await p.title(),
    };
  };

  const openUser = async (p, bookingId, userAction) => {
    const folder = `${bookingId}/email`;
    await p.goto(`https://mail.google.com/mail/u/0/#search/${bookingId}`, {
      waitUntil: "domcontentloaded",
    });
    await p.waitForTimeout(2500);

    const userLink = p
      .getByRole("link")
      .filter({ hasText: bookingId })
      .filter({ hasText: "[DEV] TravelVerse" })
      .filter({ hasNotText: "CSV2" })
      .first();
    await userLink.click();
    await shot(p, `${folder}/user-${userAction}.png`);
    return { userTitle: await p.title() };
  };

  const context = page.context();
  let adminPage =
    context.pages().find((x) => /mail\/u\/1/.test(x.url())) || page;
  let userPage =
    context.pages().find((x) => /mail\/u\/0/.test(x.url())) || page;

  const results = [];
  for (const b of bookings) {
    try {
      const meta1 = await openAdminCs(
        adminPage,
        b.id,
        b.adminAction,
        b.csAction
      );
      const meta2 = await openUser(userPage, b.id, b.userAction);
      results.push({ id: b.id, ok: true, ...meta1, ...meta2 });
    } catch (e) {
      results.push({ id: b.id, ok: false, error: String(e) });
    }
  }
  return results;
};
