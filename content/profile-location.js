const profileLocation = (() => {
  const prefix = "threads-author-location:v4:";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const cache = new Map();
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
    const entry = cache.get(handle);
    return entry?.expiresAt > Date.now() ? entry.value : null;
  }

  async function readStored(handle) {
    const key = prefix + handle;
    try {
      const entry = (await chrome.storage.local.get(key))[key];
      const current = read(handle);
      if (current !== null) return current;
      if (typeof entry?.value === "string" && entry.expiresAt > Date.now()) {
        cache.set(handle, entry);
        return entry.value;
      }
      if (entry !== undefined) await chrome.storage.local.remove(key);
    } catch {
      // Storage failures still allow a fresh lookup.
    }
    return read(handle);
  }

  async function save(handle, value) {
    const entry = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    cache.set(handle, entry);
    try {
      await chrome.storage.local.set({ [prefix + handle]: entry });
    } catch {
      // Keep using the in-memory result if storage is unavailable.
    }
  }

  const results = new Map();
  const topicsByHandle = new Map();
  const topicErrors = new Map();
  const attempts = new Map();
  const statuses = new Map();
  const MAX_CONCURRENT_LOOKUPS = 2;
  const queue = [];
  const queuedLookups = new Map();
  let activeLookups = 0;

  function processQueue() {
    while (activeLookups < MAX_CONCURRENT_LOOKUPS && queue.length > 0) {
      const visibleIndex = queue.findIndex(job => job.visibility.some(isVisible => isVisible()));
      const [job] = queue.splice(Math.max(0, visibleIndex), 1);
      queuedLookups.delete(job.handle);
      activeLookups++;
      job.run().finally(() => {
        activeLookups--;
        processQueue();
      });
    }
  }

  function lookup(handle, onStart, isVisible) {
    const cached = read(handle);
    if (cached !== null && topicsByHandle.has(handle)) return Promise.resolve(cached);
    if (results.has(handle)) {
      if (isVisible) queuedLookups.get(handle)?.visibility.push(isVisible);
      return results.get(handle);
    }
    if (Date.now() - (attempts.get(handle) || 0) < 60000) return Promise.resolve(null);
    if (cached === null) statuses.set(handle, { label: "地點查詢排隊中" });
    const run = async () => {
      attempts.set(handle, Date.now());
      if (read(handle) === null) statuses.set(handle, { label: "查詢地點中" });
      let profile;
      const getProfile = () => profile ??= threadsProfileApi.loadProfile(handle);
      const topicsTask = topicsByHandle.has(handle) ? null : threadsProfileApi.lookupTopics(handle, getProfile)
        .then(topics => {
          topicsByHandle.set(handle, topics);
          topicErrors.delete(handle);
        }, error => {
          topicErrors.set(handle, error.name === "TimeoutError" ? "Threads 主題查詢逾時" : error.message);
          console.warn("[Threads AI 帳號標記] 主題查詢失敗", handle, error.message);
        })
        .then(() => onStart?.());
      try {
        onStart?.();
        const current = await readStored(handle);
        if (current !== null) return current;
        const value = await threadsProfileApi.lookup(handle, getProfile);
        const captured = read(handle);
        if (captured !== null) return captured;
        if (typeof value === "string") await save(handle, value);
        return value;
      } catch (error) {
        statuses.set(handle, {
          label: error.name === "ThreadsSessionUnavailable" ? "登入後查詢地點" : "地點查詢失敗",
          detail: error.name === "TimeoutError" ? "Threads 查詢逾時" : error.message,
        });
        return null;
      } finally {
        try {
          onStart?.();
          await topicsTask;
        } finally {
          results.delete(handle);
        }
      }
    };
    const task = new Promise(resolve => {
      const job = { handle, visibility: isVisible ? [isVisible] : [], run: async () => resolve(await run()) };
      queue.push(job);
      queuedLookups.set(handle, job);
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
      if (value !== undefined && read(handle) !== value) void save(handle, value);
    }
  }

  return {
    read, capture, lookup,
    status: handle => statuses.get(handle),
    topics: handle => topicsByHandle.get(handle),
    topicError: handle => topicErrors.get(handle),
  };
})();
