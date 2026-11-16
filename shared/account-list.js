const accountList = (() => {
  const manualPrefix = "manual-account:";
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
    const green = new Set();
    const stored = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(manualPrefix) || value !== true) continue;
      const [type, handle] = key.slice(manualPrefix.length).split(":");
      if (type === "ai") ai.add(handle);
      if (type === "green") green.add(handle);
    }
    return { ai, green };
  }

  function add(handle, type) {
    if (type !== "ai" && type !== "green") throw new Error("未知的標記類型");
    return chrome.storage.local.set({ [manualPrefix + type + ":" + handle]: true });
  }

  return { normaliseHandle, loadHandles, add, manualPrefix };
})();
