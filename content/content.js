(() => {
  const BADGE_CLASS = "threads-ai-marker-badge";
  const MARKED_ATTR = "data-threads-ai-marker";
  const { normaliseHandle, loadHandles } = accountList;
  const POST_PATH = /^\/@[^/]+\/post\/[^/]+\/?$/i;
  const INITIAL_QUERY_DELAY_MS = 1000;
  const pendingAuthors = new Set();
  let autoQueryReady = false;
  const badgesByAuthor = new WeakMap();
  const visibleAuthors = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      const badge = badgesByAuthor.get(target);
      if (!badge?.isConnected) {
        visibleAuthors.unobserve(target);
        continue;
      }
      const handle = badge.getAttribute(MARKED_ATTR);
      const refresh = () => {
        if (badge.isConnected && badge.getAttribute(MARKED_ATTR) === handle) {
          updateBadge(badge, handle);
        }
      };
      const isVisible = () => {
        if (!target.isConnected || !badge.isConnected || badge.getAttribute(MARKED_ATTR) !== handle) return false;
        const rect = target.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && rect.bottom > 0 && rect.top < window.innerHeight
          && rect.right > 0 && rect.left < window.innerWidth;
      };
      profileLocation.lookup(handle, refresh, isVisible).then(refresh);
      refresh();
    }
  });

  function observeAuthor(name, badge) {
    const author = name.parentElement.closest("a");
    badgesByAuthor.set(author, badge);
    if (autoQueryReady) {
      visibleAuthors.observe(author);
    } else {
      pendingAuthors.add(author);
    }
  }

  function addBadge(name, handle, marks) {
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.setAttribute("role", "note");
    const location = document.createElement("span");
    location.className = "threads-ai-marker-pill threads-ai-marker-location";
    const ai = document.createElement("span");
    ai.className = "threads-ai-marker-pill threads-ai-marker-listed";
    ai.textContent = "AI 名單標記";
    const green = document.createElement("span");
    green.className = "threads-ai-marker-pill threads-ai-marker-green";
    green.textContent = "白名單";
    const topics = document.createElement("span");
    topics.className = "threads-ai-marker-pill threads-ai-marker-listed";
    badge.append(location, ai, green, topics);
    updateBadge(badge, handle, marks);
    name.after(badge);
    observeAuthor(name, badge);
  }

  function updateBadge(badge, handle, marks) {
    badge.setAttribute(MARKED_ATTR, handle);
    if (marks) {
      badge.children[1].hidden = !marks.ai.has(handle);
      badge.children[2].hidden = !marks.green.has(handle);
    }
    const location = profileLocation.read(handle);
    const status = profileLocation.status(handle);
    const locationText = location === null ? status?.label || "等待查詢地點" : location || "無顯示地點";
    const locationBadge = badge.firstElementChild;
    if (locationBadge.textContent !== locationText) locationBadge.textContent = locationText;
    locationBadge.title = location === null
      ? status?.detail || locationText
      : "";
    const topicBadge = badge.children[3];
    const topicError = profileLocation.topicError(handle);
    const topicText = profileLocation.topics(handle)?.join(" · ") || (topicError ? "主題查詢失敗" : "");
    if (topicBadge.textContent !== topicText) topicBadge.textContent = topicText;
    topicBadge.title = topicError || "";
    topicBadge.hidden = !topicText;
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
      if (!handle) return;
      const post = permalink.pathname.replace(/\/$/, "");
      if (markedPosts.has(post)) return;
      const name = findAuthorName(permalink, handle);
      if (!name) return;
      markedPosts.add(post);
      const badge = name.nextSibling;
      if (badge?.hasAttribute?.(MARKED_ATTR)) {
        if (badge.getAttribute(MARKED_ATTR) !== handle) observeAuthor(name, badge);
        updateBadge(badge, handle, handles);
      } else {
        addBadge(name, handle, handles);
      }
    });
  }

  async function start() {
    try {
      let handles = await loadHandles();

      let scheduled = false;
      const scan = () => {
        scheduled = false;
        profileLocation.capture();
        markKnownAccounts(handles);
      };
      const scheduleScan = () => {
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(scan);
        }
      };

      scan();
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local" || !Object.keys(changes).some(key => key.startsWith(accountList.manualPrefix))) return;
        try {
          handles = await loadHandles();
          scheduleScan();
        } catch (error) {
          console.warn("[Threads AI 帳號標記] 名單更新失敗", error);
        }
      });
      new MutationObserver(scheduleScan).observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    } catch (error) {
      console.warn("[Threads AI 帳號標記] 啟動失敗", error);
    }
  }

  setTimeout(() => {
    autoQueryReady = true;
    for (const author of pendingAuthors) {
      if (author.isConnected) visibleAuthors.observe(author);
    }
    pendingAuthors.clear();
  }, INITIAL_QUERY_DELAY_MS);

  start();
})();
