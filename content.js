(() => {
  const BADGE_CLASS = "threads-ai-marker-badge";
  const MARKED_ATTR = "data-threads-ai-marker";
  const HANDLE_PATTERN = /^\/@([a-z0-9._-]+)(?:\/|$)/i;
  const POST_PATH = /^\/@[^/]+\/post\/[^/]+\/?$/i;

  function normaliseHandle(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;

    try {
      const url = new URL(trimmed, "https://www.threads.com/");
      if (url.hostname !== "www.threads.com" && url.hostname !== "threads.com") return null;
      const match = url.pathname.match(HANDLE_PATTERN);
      return match ? match[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  async function loadHandles() {
    const listUrl = chrome.runtime.getURL("threads_list.txt");
    const response = await fetch(listUrl);
    if (!response.ok) throw new Error(`無法讀取名單：${response.status}`);

    return new Set(
      (await response.text())
        .split(/\r?\n/)
        .map(normaliseHandle)
        .filter(Boolean),
    );
  }

  function addBadge(name) {
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.setAttribute(MARKED_ATTR, "");
    badge.setAttribute("role", "note");
    badge.textContent = "AI 名單標記";
    name.after(badge);
  }

  function findAuthorName(permalink, handle) {
    // The post header is the first ancestor containing both the timestamp and author.
    for (let row = permalink.parentElement; row && row !== document.body; row = row.parentElement) {
      if (row.querySelectorAll("a time[datetime]").length > 1) return null;
      for (const anchor of row.querySelectorAll("a[href]")) {
        if (!(anchor.compareDocumentPosition(permalink) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (anchor.closest('h1, h2, [role="heading"], [role="tablist"], [role="tab"], nav')) continue;
        if (anchor.pathname.replace(/\/$/, "").toLowerCase() !== `/@${handle}`) continue;
        if (normaliseHandle(anchor.href) !== handle) continue;

        const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const name = walker.currentNode;
          if (name.parentElement.closest('[hidden], [aria-hidden="true"]')) continue;
          const text = name.data.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069]/g, "").trim();
          if (text.replace(/^@/, "").toLowerCase() === handle) return name;
        }
      }
    }
    return null;
  }

  function markKnownAccounts(handles) {
    const markedPosts = new Set();
    document.querySelectorAll("a[href] > time[datetime]").forEach((time) => {
      const permalink = time.parentElement;
      if (!POST_PATH.test(permalink.pathname)) return;
      const handle = normaliseHandle(permalink.href);
      if (!handles.has(handle)) return;
      const post = permalink.pathname.replace(/\/$/, "");
      if (markedPosts.has(post)) return;
      const name = findAuthorName(permalink, handle);
      if (!name) return;
      markedPosts.add(post);
      if (!name.nextSibling?.hasAttribute?.(MARKED_ATTR)) addBadge(name);
    });
  }

  async function start() {
    try {
      const handles = await loadHandles();
      if (!handles.size) return;

      let scheduled = false;
      const scan = () => {
        scheduled = false;
        markKnownAccounts(handles);
      };
      const scheduleScan = () => {
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(scan);
        }
      };

      scan();
      new MutationObserver(scheduleScan).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (error) {
      console.warn("[Threads AI 帳號標記] 啟動失敗", error);
    }
  }

  start();
})();
