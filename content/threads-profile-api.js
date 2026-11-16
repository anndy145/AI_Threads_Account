const threadsProfileApi = (() => {
  const endpoint = "/async/wbloks/fetch/?appid=com.bloks.www.text_post_app.about_this_profile_async_action&type=app&__bkv=22713cafbb647b89c4e9c1acdea97d89c8c2046e2f4b18729760e9b1ae0724f7";
  const locationLabel = /^(?:Based in|Account based in|(?:帳號|帳戶)?(?:所在地點|所在地區|所在地|位置)|所在地区|위치|거주지)\s*[:：]?$/i;
  const hidden = /^(未分享|未公開|未顯示|無顯示地點|Not shared|Not displayed|Not shown|Hidden)$/i;
  const topicQueryName = "BarcelonaProfilePageDirectQuery";
  let pausedUntil = 0;

  function* objects(root) {
    const pending = [root];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      yield value;
      const children = Object.values(value);
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
  }

  function findId(page, handle) {
    for (const script of page.querySelectorAll('script[type="application/json"]')) {
      if (!script.textContent.includes(handle)) continue;
      let data;
      try {
        // Preserve numeric IDs larger than JavaScript's safe integer range.
        data = JSON.parse(script.textContent, (key, value, context) =>
          /^(id|pk)$/.test(key) && typeof value === "number" ? context?.source : value);
      } catch {
        continue;
      }
      for (const user of objects(data)) {
        if (typeof user.username !== "string" || user.username.toLowerCase() !== handle) continue;
        const id = [user.pk, user.id].find(value => typeof value === "string" && /^\d+$/.test(value));
        if (id) return id;
      }
    }
  }

  function findProfileRouteId(page, handle) {
    const canonical = page.querySelector('link[rel="canonical"]')?.href;
    if (!canonical) return;
    const url = new URL(canonical, location.origin);
    if (url.origin !== location.origin || url.pathname.replace(/\/$/, "").toLowerCase() !== "/@" + handle) return;

    // Threads profile routes can provide the ID in root props without a user object.
    const ids = new Set();
    for (const script of page.querySelectorAll("script:not([src])")) {
      for (const match of script.textContent.matchAll(/"resource"\s*:\s*\{\s*"__dr"\s*:\s*"BarcelonaProfileThreadsRoot\.react"\s*\}\s*,\s*"props"\s*:\s*\{[^{}]*?"user_id"\s*:\s*"(\d+)"/g)) {
        ids.add(match[1]);
      }
    }
    if (ids.size === 1) return ids.values().next().value;
  }

  function resolveProfileId(profile, handle) {
    const id = findId(profile, handle) || findProfileRouteId(profile, handle);
    if (id) return id;
    const url = profile.querySelector('meta[property="al:ios:url"]')?.content;
    return url?.match(/^instagram:\/\/user\?userid=(\d+)(?:&|$)/)?.[1];
  }

  function parseComponents(data, diagnostics) {
    let locationField = false;
    for (const node of objects(data)) {
      const rich = node["bk.components.RichText"];
      const part = node["bk.components.Text"] || rich;
      if (!part) continue;
      const text = typeof part.text === "string" ? part.text.trim()
        : (Array.isArray(rich?.children) ? rich.children
          .map(child => child?.["bk.components.TextSpan"]?.text || "").join("").trim() : "");
      if (locationLabel.test(text)) {
        locationField = true;
      } else if (part.text_style === "semibold") {
        locationField = false;
      } else if (part.text_style === "normal" && locationField) {
        if (text) return hidden.test(text) ? "" : text;
        const bound = readLocationBinding(part.on_bind);
        if (bound !== null) return bound;
        if (typeof part.on_bind === "string") {
          diagnostics.locationBinding = describeLocationBinding(part.on_bind, data);
        }
        locationField = false;
      }
    }
    return null;
  }

  function describeLocationBinding(binding, data) {
    const variable = binding.match(/\(\s*bk\.action\.bloks\.GetVariable2\s*,\s*("(?:[^"\\]|\\.)*")\s*\)/);
    let availability = "";
    if (variable) {
      const key = JSON.parse(variable[1]);
      const values = new Set();
      for (const node of objects(data)) {
        if (Object.hasOwn(node, key) && typeof node[key] === "boolean") values.add(node[key]);
      }
      availability = values.size === 0 ? "；回應中找不到同名布林欄位"
        : values.size === 1 ? "；回應中有同名布林欄位，作用域待確認"
          : "；回應中有多個不同的同名布林值";
    }
    // Report expression structure without exposing branch values or variable names.
    const tokens = binding.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[(),]|[^(),\s"']+/g) || [];
    return tokens.slice(0, 100).map(token => {
      if (/^[(),]$/.test(token)) return token;
      if (/^bk\.action\.[a-zA-Z0-9_.]+$/.test(token)) return token.slice("bk.action.".length);
      if (/^(true|false|null)$/.test(token)) return token;
      return /^["']/.test(token) ? "字串" : "值";
    }).join("") + (tokens.length > 100 ? "…" : "") + availability;
  }

  function parseResponse(body) {
    const data = JSON.parse(body.trim().replace(/^for\s*\(\s*;;\s*\);\s*/, ""));
    if (data?.error || data?.errors?.length) throw new Error("Threads 拒絕個人檔案查詢");
    const trees = [data];
    let components = 0;
    let labels = 0;
    let bindings = 0;
    const diagnostics = {};
    // Some responses wrap Bloks component trees in multiple JSON envelopes.
    for (let index = 0; index < trees.length && index < 64; index++) {
      const tree = trees[index];
      const result = parseComponents(tree, diagnostics);
      if (result !== null) return result;
      for (const node of objects(tree)) {
        const part = node["bk.components.Text"] || node["bk.components.RichText"];
        if (part) {
          components++;
          if (typeof part.text === "string" && locationLabel.test(part.text.trim())) labels++;
          if (typeof part.on_bind === "string") bindings++;
        }
        for (const value of Object.values(node)) {
          if (trees.length >= 64) break;
          if (typeof value !== "string" || !/^\s*[\[{" ]/.test(value) || !value.includes("bk.components.")) continue;
          try {
            trees.push(JSON.parse(value));
          } catch {
            // Other strings may contain Bloks expressions rather than JSON.
          }
        }
      }
    }
    if (diagnostics.locationBinding) {
      throw new Error("所在地由未支援的條件決定（" + diagnostics.locationBinding + "）");
    }
    throw new Error("無法辨識所在地（資料層 " + Math.min(trees.length, 64)
      + "／文字元件 " + components + "／所在地標籤 " + labels + "／條件欄位 " + bindings + "）");
  }

  function readLocationBinding(binding) {
    if (typeof binding !== "string") return null;
    binding = binding.trim();
    // Bloks can bind text through an array containing the property name and value.
    const textBinding = binding.match(/^\(\s*bk\.action\.array\.Make\s*,\s*"text"\s*,\s*(\([\s\S]*\))\s*\)$/);
    if (textBinding) binding = textBinding[1];
    const opening = binding.match(/^\(\s*bk\.action\.core\.If\s*,/);
    if (!opening) return null;
    const branches = binding.match(/,\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)\s*$/);
    if (!branches) return null;
    try {
      const first = JSON.parse(branches[1]).trim();
      const second = JSON.parse(branches[2]).trim();
      const condition = binding.slice(opening[0].length, branches.index).trim();
      if (condition === "true" || condition === "false") {
        const rendered = condition === "true" ? first : second;
        return hidden.test(rendered) ? "" : rendered;
      }
      // Match Lee-Su-Threads when the response does not resolve the condition.
      const candidate = first || second;
      return hidden.test(candidate) ? "" : candidate;
    } catch {
      return null;
    }
  }

  async function request(path, init) {
    if (Date.now() < pausedUntil) throw new Error("Threads 暫時限制查詢，稍後重試");
    const url = new URL(path, location.origin);
    const method = init?.method || "GET";
    const requestName = method + " " + url.pathname;
    let response;
    try {
      response = await fetch(url, {
        ...init, credentials: "same-origin", signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      if (error.name === "TimeoutError") throw error;
      throw new Error(requestName + " 無法連線（" + error.message + "）");
    }
    if (response.type === "opaqueredirect") throw new Error(requestName + " 被 Threads 重新導向");
    if (response.status === 429) pausedUntil = Date.now() + 60000;
    if (!response.ok || new URL(response.url).origin !== location.origin) {
      throw new Error(requestName + " 查詢失敗（HTTP " + response.status + "）");
    }
    try {
      return await response.text();
    } catch (error) {
      if (error.name === "TimeoutError") throw error;
      throw new Error(requestName + " 無法讀取回應（" + error.message + "）");
    }
  }

  async function loadProfile(handle) {
    if (!/^[a-z0-9._-]+$/.test(handle)) throw new Error("無效的 Threads 帳號");
    return new DOMParser().parseFromString(await request("/@" + handle), "text/html");
  }

  function* pageData(page, marker) {
    for (const script of page.querySelectorAll('script[type="application/json"]')) {
      if (!script.textContent.includes(marker)) continue;
      try {
        yield JSON.parse(script.textContent);
      } catch {
        // Some inline scripts do not contain complete JSON.
      }
    }
  }

  function readTopics(payloads, handle) {
    const matching = new Set();
    let found = false;
    for (const data of payloads) {
      for (const user of objects(data)) {
        if (typeof user.username !== "string" || user.username.toLowerCase() !== handle
          || !Array.isArray(user.profile_tags?.edges)) continue;
        found = true;
        for (const edge of user.profile_tags.edges) {
          const name = edge?.node?.tag_cluster_name;
          if (typeof name === "string") {
            const topic = name.trim().toLowerCase();
            if (topic === "ai threads") matching.add("AI Threads");
            if (topic === "ai art") matching.add("AI Art");
          }
        }
      }
    }
    if (found) return [...matching];
    return null;
  }

  function findTopicQuery(profile) {
    for (const data of pageData(profile, '"expectedPreloaders"')) {
      for (const node of objects(data)) {
        const query = node.expectedPreloaders?.find?.(item =>
          item?.queryName === topicQueryName &&
          typeof item.queryID === "string" && /^\d+$/.test(item.queryID) &&
          typeof item.variables?.userID === "string" && /^\d+$/.test(item.variables.userID));
        if (query) return query;
      }
    }
  }

  function fallbackTopicQuery(handle, profile) {
    const userID = findId(document, handle) || resolveProfileId(profile, handle);
    if (!userID) throw new Error("主題查詢找不到 Threads 作者 ID");

    // Profile query and Relay provider values from the saved logged-in profile pages.
    const providers = {
      IsLoggedIn: true,
      HasProfileInformTreatmentInfo: false,
      HasMessaging: true,
      IsLoggedOut: false,
      HasProfileCardsCollection: false,
      HasPodcastV2Production: false,
      HasInsightsProfileM2: true,
      HasProfileCover: false,
      IsInternalUser: false,
      HasPublicViewCountShareCard: true,
      MessagesHasLiveChatMessaging: true,
      HasEventBadge: false,
      HasCommunitiesOrLoggedOut: true,
      HasWebFavicons: true,
      HasCommunityTopContributors: false,
      HasCommunityFounderCard: true,
      ShouldShowFediverseM1Features: true,
      OptInNotifWebEnabled: false,
    };
    const variables = { showLinkedIGStats: false, userID };
    for (const [name, value] of Object.entries(providers)) {
      variables["__relay_internal__pv__Barcelona" + name + "relayprovider"] = value;
    }
    return { queryName: topicQueryName, queryID: "28946218358361552", variables };
  }

  function* graphqlData(text) {
    const payload = text.trim().replace(/^for\s*\(;;\);\s*/, "");
    try {
      yield JSON.parse(payload);
      return;
    } catch {
      // Relay can return a stream of newline-delimited JSON objects.
    }
    for (const line of payload.split(/\r?\n/)) {
      try {
        yield JSON.parse(line.trim().replace(/^for\s*\(;;\);\s*/, ""));
      } catch {
        // Ignore framing lines.
      }
    }
  }

  function readSession(profile) {
    const pages = profile ? [document, profile] : [document];
    const scripts = pages.flatMap(page =>
      [...page.querySelectorAll("script:not([src])")].map(script => script.textContent)).join("\n");
    const token = document.querySelector('input[name="fb_dtsg"]')?.value
      || scripts.match(/"fb_dtsg"\s*:\s*"([^"]+)"/)?.[1]
      || scripts.match(/"DTSGInit(?:ial)?Data"[^{}]*\{[^{}]*"token"\s*:\s*"([^"]+)"/)?.[1];
    const lsd = scripts.match(/"LSD"[^{}]*\{[^{}]*"token"\s*:\s*"([^"]+)"/)?.[1] || "";
    return { scripts, token, lsd };
  }

  async function lookupTopics(handle, getProfile) {
    const inline = readTopics(pageData(document, '"profile_tags"'), handle);
    if (inline?.length) return inline;
    const profile = await getProfile();
    const embedded = readTopics(pageData(profile, '"profile_tags"'), handle);
    if (embedded !== null) return embedded;

    const query = findTopicQuery(profile) ?? fallbackTopicQuery(handle, profile);
    const { scripts, token, lsd } = readSession(profile);
    const headers = {
      "X-FB-Friendly-Name": query.queryName,
      "X-IG-App-ID": "238260118697367",
      "X-Root-Field-Name": "xdt_text_app_user",
    };
    const csrf = scripts.match(/"InstagramSecurityConfig"\s*,\s*\[[^\]]*\]\s*,\s*\{\s*"csrf_token"\s*:\s*"([^"]+)"/)?.[1];
    if (csrf) headers["X-CSRFToken"] = csrf;
    const bloksVersion = scripts.match(/"WebBloksVersioningID"\s*,\s*\[\]\s*,\s*\{\s*"versioningID"\s*:\s*"([a-f0-9]+)"/)?.[1];
    if (bloksVersion) headers["X-BLOKS-VERSION-ID"] = bloksVersion;
    const body = new URLSearchParams({
      __a: "1",
      __user: "0",
      fb_dtsg: token || "",
      lsd,
      doc_id: query.queryID,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: query.queryName,
      server_timestamps: "true",
      variables: JSON.stringify(query.variables),
    });
    // Threads routes this Relay operation through its Distillery GraphQL endpoint.
    const response = await request("/graphql/query", { method: "POST", headers, body, redirect: "manual" });
    const topics = readTopics(graphqlData(response), handle);
    if (topics === null) throw new Error("Threads 回應未包含作者的主題標籤資料");
    return topics;
  }

  async function lookup(handle, getProfile) {
    if (!/^[a-z0-9._-]+$/.test(handle)) return null;
    let profile;
    let id = findId(document, handle);
    if (!id) {
      profile = await getProfile();
      id = resolveProfileId(profile, handle);
    }
    const { scripts, token, lsd } = readSession(profile);
    if (!token) {
      const error = new Error("Threads 未提供查詢工作階段。登入後請重新整理頁面。");
      error.name = "ThreadsSessionUnavailable";
      throw error;
    }
    if (!id) throw new Error("找不到 Threads 作者 ID");

    const body = new URLSearchParams({
      __user: "0", __a: "1", __comet_req: "29", __d: "www", fb_dtsg: token,
      lsd,
      jazoest: scripts.match(/"jazoest"\s*:\s*"?(\d+)/)?.[1] || "",
      params: JSON.stringify({
        atpTriggerSessionID: crypto.randomUUID(),
        referer_type: "TextPostAppProfileOverflow",
        target_user_id: id,
      }),
    });
    const pageRevision = scripts.match(/"__spin_r"\s*:\s*"?(\d+)/)?.[1];
    const pageTimestamp = scripts.match(/"__spin_t"\s*:\s*"?(\d+)/)?.[1];
    if (pageRevision) {
      body.set("__rev", pageRevision);
      body.set("__spin_r", pageRevision);
      body.set("__spin_b", "trunk");
    }
    if (pageTimestamp) body.set("__spin_t", pageTimestamp);
    const response = await request(endpoint, {
      method: "POST",
      headers: {"X-FB-Friendly-Name": "BarcelonaProfileAboutThisProfileAsyncActionQuery"},
      body,
    });
    try {
      return parseResponse(response);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error("Threads 回應格式不符合預期");
    }
  }

  return { loadProfile, lookup, lookupTopics };
})();
