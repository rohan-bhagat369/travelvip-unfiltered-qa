(async () => {
  const FIELD = 'a81f3e39-1d63-4cd8-8edd-727df3028edc';
  const keys = ["ENG-761", "ENG-760", "ENG-759", "ENG-758", "ENG-757", "ENG-756", "ENG-755", "ENG-754", "ENG-753", "ENG-752", "ENG-751", "ENG-750", "ENG-749", "ENG-748", "ENG-747", "ENG-746", "ENG-745", "ENG-744", "ENG-743", "ENG-742", "ENG-741", "ENG-740", "ENG-739", "ENG-738", "ENG-737", "ENG-736", "ENG-735", "ENG-734", "ENG-733", "ENG-732", "ENG-731", "ENG-730", "ENG-729", "ENG-728", "ENG-727", "ENG-726", "ENG-725", "ENG-724", "ENG-723", "ENG-722", "ENG-721", "ENG-720", "ENG-719", "ENG-718", "ENG-717", "ENG-715", "ENG-714", "ENG-713", "ENG-712", "ENG-711", "ENG-710", "ENG-709", "ENG-708", "ENG-707", "ENG-706", "ENG-705", "ENG-704", "ENG-703", "ENG-702", "ENG-701", "ENG-700", "ENG-699", "ENG-698", "ENG-697", "ENG-696", "ENG-695", "ENG-694", "ENG-693", "ENG-692", "ENG-691", "ENG-690", "ENG-689", "ENG-688", "ENG-687", "ENG-686", "ENG-685", "ENG-684", "ENG-683", "ENG-682", "ENG-681", "ENG-680", "ENG-679", "ENG-678", "ENG-677", "ENG-676", "ENG-675", "ENG-674", "ENG-673", "ENG-672", "ENG-671", "ENG-670", "ENG-669", "ENG-668", "ENG-667", "ENG-666", "ENG-665", "ENG-664", "ENG-663", "ENG-662", "ENG-661", "ENG-660", "ENG-659", "ENG-658", "ENG-657", "ENG-656", "ENG-655", "ENG-654", "ENG-653", "ENG-652", "ENG-651", "ENG-650", "ENG-649", "ENG-648", "ENG-647", "ENG-646", "ENG-645", "ENG-644", "ENG-643", "ENG-642"];
  const results = [];
  for (const key of keys) {
    try {
      const r = await fetch(`/api/v1/tasks/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fields: { [FIELD]: ['DEV'] } }),
      });
      results.push({ key, status: r.status, ok: r.ok });
      if (!r.ok) results[results.length-1].body = (await r.text()).slice(0,200);
    } catch (e) {
      results.push({ key, ok: false, error: String(e) });
    }
  }
  const ok = results.filter(x => x.ok).length;
  const fail = results.filter(x => !x.ok);
  console.table(results);
  console.log(`DONE ok=${ok} fail=${fail.length}`, fail);
  return { ok, fail: fail.length, failKeys: fail.map(x => x.key) };
})();
