const accountList = (() => {
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
    return new Set((await response.text()).split(/\r?\n/).map(normaliseHandle).filter(Boolean));
  }

  return { normaliseHandle, loadHandles };
})();
