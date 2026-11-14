const profileLocation = (() => {
  const prefix = "threads-author-location:v3:";
  const headings = /^(關於(?:此|這個|這份)個人檔案|关于此个人主页|About this profile)$/i;
  const labels = /^(?:帳號)?(?:所在地點|所在地|所在地区|所在地區|位置)|^(?:Account )?Based in/i;
  const nameLabel = /^(名稱|名字|Name)[:：]?$/i;
  const joinedLabel = /^(已加入|加入日期|加入時間|加入時間點|Joined|Date joined|Joined Threads|加入 Threads)[:：]?$/i;
  const otherFields = /^(先前的用戶名稱|先前的使用者名稱|Former usernames|Previous usernames|已驗證|Verified|關閉|Close|完成|Done)[:：]?$/i;
  const absent = /^(無顯示地點|未顯示|未分享|未公開|無法顯示|不公開|未提供|Not shared|Not displayed|Not shown|Not available|Hidden)$/i;

  function parse(lines) {
    for (const [index, line] of lines.entries()) {
      const match = line.match(labels);
      if (!match) continue;
      const rest = line.slice(match[0].length).trim();
      if (rest && !/^[：:]/.test(rest)) continue;
      const value = rest.replace(/^[：:]\s*/, "") || lines[index + 1];
      if (!value || headings.test(value) || nameLabel.test(value) || joinedLabel.test(value)
        || otherFields.test(value) || labels.test(value) || value.startsWith("@")) continue;
      return absent.test(value) ? "" : value;
    }
    return undefined;
  }

  function read(handle) {
    try {
      return sessionStorage.getItem(prefix + handle);
    } catch {
      return null;
    }
  }

  const results = new Map();
  const attempts = new Map();
  const statuses = new Map();
  const MAX_CONCURRENT_LOOKUPS = 2;
  const queue = [];
  let activeLookups = 0;

  function processQueue() {
    while (activeLookups < MAX_CONCURRENT_LOOKUPS && queue.length > 0) {
      activeLookups++;
      queue.shift()().finally(() => {
        activeLookups--;
        processQueue();
      });
    }
  }

  function lookup(handle, onStart) {
    const cached = read(handle);
    if (cached !== null) return Promise.resolve(cached);
    if (results.has(handle)) return results.get(handle);
    if (Date.now() - (attempts.get(handle) || 0) < 60000) return Promise.resolve(null);
    statuses.set(handle, { label: "地點查詢排隊中" });
    const run = async () => {
      attempts.set(handle, Date.now());
      statuses.set(handle, { label: "查詢地點中" });
      try {
        onStart?.();
        const current = read(handle);
        if (current !== null) return current;
        const value = await threadsProfileApi.lookup(handle);
        const captured = read(handle);
        if (captured !== null) return captured;
        if (value !== null) sessionStorage.setItem(prefix + handle, value);
        return value;
      } catch (error) {
        statuses.set(handle, {
          label: error.name === "ThreadsSessionUnavailable" ? "登入後查詢地點" : "地點查詢失敗",
          detail: error.name === "TimeoutError" ? "Threads 查詢逾時" : error.message,
        });
        return null;
      } finally {
        results.delete(handle);
      }
    };
    const task = new Promise(resolve => {
      queue.push(async () => resolve(await run()));
    });
    results.set(handle, task);
    processQueue();
    return task;
  }

  function capture() {
    const handle = accountList.normaliseHandle(location.href);
    if (!handle || location.pathname.replace(/\/$/, "").toLowerCase() !== "/@" + handle) return;

    for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')) {
      if (dialog.closest('[hidden], [aria-hidden="true"]') || !dialog.getClientRects().length) continue;
      const text = dialog.innerText;
      if (!text) continue;
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const nameIndex = lines.findIndex(line => nameLabel.test(line));
      const panelHandle = lines[nameIndex + 1]?.match(/[（(]\s*@([a-z0-9._-]+)\s*[）)]\s*$/i)?.[1]?.toLowerCase();
      if (panelHandle && panelHandle !== handle) continue;
      const hasProfileFields = nameIndex >= 0 && panelHandle === handle && lines.some(line => joinedLabel.test(line));
      if (!hasProfileFields && !lines.some(line => headings.test(line))) continue;
      const value = parse(lines);
      if (value === undefined) continue;
      try {
        sessionStorage.setItem(prefix + handle, value);
      } catch {
        return;
      }
    }
  }

  return { read, capture, lookup, status: handle => statuses.get(handle) };
})();
