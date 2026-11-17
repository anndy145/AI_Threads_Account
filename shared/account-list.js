const accountList = (() => {
  const manualPrefix = "manual-account:";
  const themeKey = "popup-theme";
  const themeModes = ["system", "light", "dark"];

  async function loadTheme() {
    const stored = await chrome.storage.local.get(themeKey);
    return themeModes.includes(stored[themeKey]) ? stored[themeKey] : "system";
  }
  const displayKeys = {
    location: "auto-lookup-location",
    aiThreads: "show-ai-threads",
    aiArt: "show-ai-art",
    allowlist: "show-allowlist",
    manualAi: "show-manual-ai",
  };
  const legacyTopicsKey = "auto-lookup-topics";
  const displayStorageKeys = [...Object.values(displayKeys), legacyTopicsKey];

  async function loadDisplaySettings() {
    const stored = await chrome.storage.local.get(displayStorageKeys);
    const legacyTopics = stored[legacyTopicsKey] === true;
    const aiThreads = stored[displayKeys.aiThreads] ?? legacyTopics;
    const aiArt = stored[displayKeys.aiArt] ?? legacyTopics;
    return {
      location: stored[displayKeys.location] === true,
      topics: aiThreads === true || aiArt === true,
      aiThreads: aiThreads === true,
      aiArt: aiArt === true,
      allowlist: stored[displayKeys.allowlist] !== false,
      manualAi: stored[displayKeys.manualAi] !== false,
    };
  }
  function normaliseHandle(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    if (/^@?[a-z0-9._-]+$/i.test(trimmed)) {
      return trimmed.replace(/^@/, "").toLowerCase();
    }

    try {
      const url = new URL(trimmed, "https://www.threads.com/");
      if (url.hostname !== "www.threads.com" && url.hostname !== "threads.com") return null;
      const match = url.pathname.match(/^\/@([a-z0-9._-]+)(?:\/|$)/i);
      return match ? match[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  async function loadHandles() {
    const response = await fetch(chrome.runtime.getURL("data/threads_list.txt"));
    if (!response.ok) throw new Error("無法讀取名單：" + response.status);
    const ai = new Set((await response.text()).split(/\r?\n/).map(normaliseHandle).filter(Boolean));
    const manual = await loadManualHandles();
    return { bundledAi: ai, manualAi: manual.ai, green: manual.green };
  }

  async function loadManualHandles() {
    const lists = { ai: new Set(), green: new Set() };
    const stored = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(manualPrefix) || value !== true) continue;
      const [type, handle] = key.slice(manualPrefix.length).split(":");
      if (handle && (type === "ai" || type === "green")) lists[type].add(handle);
    }
    // Older versions could store both marks. Preserve the existing allowlist priority.
    for (const handle of lists.green) lists.ai.delete(handle);
    return lists;
  }

  function manualKey(handle, type) {
    if (type !== "ai" && type !== "green") throw new Error("未知的標記類型");
    return manualPrefix + type + ":" + handle;
  }

  function add(handle, type) {
    const key = manualKey(handle, type);
    const previousKey = manualKey(handle, type === "ai" ? "green" : "ai");
    return chrome.storage.local.set({ [key]: true, [previousKey]: false });
  }

  function remove(handle, type) {
    const key = manualKey(handle, type);
    // Removing a legacy allowlist mark must not revive its hidden AI mark.
    return chrome.storage.local.remove(type === "green" ? [key, manualKey(handle, "ai")] : key);
  }

  async function restorePersonalData(lists, settings, replace) {
    const updates = {};
    const setMark = (handle, type) => {
      updates[manualKey(handle, "ai")] = type === "ai";
      updates[manualKey(handle, "green")] = type === "green";
    };
    if (replace) {
      const existing = await loadManualHandles();
      for (const handle of [...existing.ai, ...existing.green]) setMark(handle, null);
    }
    for (const handle of lists.manualAi) setMark(handle, "ai");
    for (const handle of lists.allowlist) setMark(handle, "green");
    for (const [feature, key] of Object.entries(displayKeys)) updates[key] = settings[feature];
    if (themeModes.includes(settings.theme)) updates[themeKey] = settings.theme;
    await chrome.storage.local.set(updates);
  }

  return {
    normaliseHandle, loadHandles, loadManualHandles, add, remove, manualPrefix,
    displayKeys, displayStorageKeys, loadDisplaySettings, restorePersonalData, themeKey, themeModes, loadTheme,
  };
})();
