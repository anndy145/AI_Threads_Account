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
  const lookupJobs = new Map();
  const pendingRetries = new Map();
  let activeLookups = 0;

  function processQueue() {
    while (activeLookups < MAX_CONCURRENT_LOOKUPS && queue.length > 0) {
      const visibleIndex = queue.findIndex(job => job.visibility.some(isVisible => isVisible()));
      const [job] = queue.splice(Math.max(0, visibleIndex), 1);
      activeLookups++;
      job.run().finally(() => {
        activeLookups--;
        processQueue();
      });
    }
  }

  function lookup(handle, onUpdate, isVisible, settings, isRetry = false) {
    const cached = read(handle);
    if ((!settings.location || cached !== null) && (!settings.topics || topicsByHandle.has(handle))) {
      return Promise.resolve(cached);
    }
    const currentJob = lookupJobs.get(handle) || pendingRetries.get(handle);
    if (currentJob) {
      if (isVisible) currentJob.visibility.push(isVisible);
      if (onUpdate) currentJob.updates.add(onUpdate);
      const inFlight = results.get(handle);
      return inFlight ? inFlight.then(() => lookup(handle, onUpdate, isVisible, settings, isRetry)) : Promise.resolve(cached);
    }
    const canAttempt = feature => settings[feature]
      && (isRetry || Date.now() - (attempts.get(handle)?.[feature] ?? -Infinity) >= 60000);
    const needsLocation = () => canAttempt("location") && read(handle) === null;
    const needsTopics = () => canAttempt("topics") && !topicsByHandle.has(handle);
    if (!needsLocation() && !needsTopics()) return Promise.resolve(cached);
    if (needsLocation()) statuses.set(handle, { label: "地點查詢排隊中" });
    let retryAt = 0;
    const job = {
      visibility: isVisible ? [isVisible] : [],
      updates: new Set(onUpdate ? [onUpdate] : []),
    };
    const notify = () => {
      for (const update of job.updates) update();
    };
    const rememberRetry = error => {
      if (Number.isFinite(error.retryAt)) retryAt = Math.max(retryAt, error.retryAt);
    };
    const run = async () => {
      const checkLocation = needsLocation();
      const checkTopics = needsTopics();
      const previous = attempts.get(handle) || {};
      if (checkLocation) {
        previous.location = Date.now();
        statuses.set(handle, { label: "查詢地點中" });
      }
      if (checkTopics) previous.topics = Date.now();
      if (checkLocation || checkTopics) attempts.set(handle, previous);
      let profile;
      const getProfile = () => profile ??= threadsProfileApi.loadProfile(handle);
      let locationFinished = false;
      let topicsFinished = !checkTopics;
      const topicsTask = topicsFinished ? null : threadsProfileApi.lookupTopics(handle, getProfile)
        .then(topics => {
          topicsByHandle.set(handle, topics);
          topicErrors.delete(handle);
        }, error => {
          rememberRetry(error);
          topicErrors.set(handle, error.name === "TimeoutError" ? "Threads 主題查詢逾時" : error.message);
          console.warn("[Threads AI 帳號標記] 主題查詢失敗", handle, error.message);
        })
        .then(() => {
          topicsFinished = true;
          if (!locationFinished) notify();
        });
      try {
        notify();
        if (!checkLocation) return read(handle);
        const current = await readStored(handle);
        if (current !== null || !settings.location) return current;
        const value = await threadsProfileApi.lookup(handle, getProfile);
        const captured = read(handle);
        if (captured !== null) return captured;
        if (typeof value === "string") await save(handle, value);
        return value;
      } catch (error) {
        rememberRetry(error);
        statuses.set(handle, {
          label: error.name === "ThreadsSessionUnavailable" ? "登入後查詢地點" : "地點查詢失敗",
          detail: error.name === "TimeoutError" ? "Threads 查詢逾時" : error.message,
        });
        return null;
      } finally {
        locationFinished = true;
        try {
          if (!topicsFinished) notify();
          await topicsTask;
        } finally {
          results.delete(handle);
          lookupJobs.delete(handle);
          if (!isRetry && retryAt && job.visibility.length) {
            const hasVisibleAuthor = () => job.visibility.some(check => check());
            pendingRetries.set(handle, job);
            setTimeout(() => {
              pendingRetries.delete(handle);
              if (hasVisibleAuthor()) void lookup(handle, notify, hasVisibleAuthor, settings, true).then(notify);
            }, Math.max(0, retryAt - Date.now()));
          }
        }
      }
    };
    const task = new Promise(resolve => {
      job.run = async () => resolve(await run());
      queue.push(job);
      lookupJobs.set(handle, job);
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
