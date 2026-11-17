const form = document.querySelector("#account-search");
const input = document.querySelector("#account");
const result = document.querySelector("#search-result");
const buttons = form.querySelectorAll('button[type="submit"]');
const fillAccount = document.querySelector("#fill-account");
const openSettingsTab = document.querySelector("#open-settings-tab");
const type = document.querySelector("#account-type");
const listStatus = document.querySelector("#list-status");
const pageParams = new URLSearchParams(window.location.search);
const isSettingsTab = pageParams.get("view") === "settings";
const sourceHandle = isSettingsTab ? accountList.normaliseHandle(pageParams.get("from") || "") : null;

if (isSettingsTab) {
  document.body.classList.add("settings-tab");
  document.title = "Threads AI 帳號標記設定";
  openSettingsTab.hidden = true;
  fillAccount.hidden = !sourceHandle;
  fillAccount.textContent = "帶入原分頁帳號";
  const searchHandle = accountList.normaliseHandle(pageParams.get("account") || "");
  if (searchHandle) input.value = "@" + searchHandle;
}

async function activeThreadsHandle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return accountList.normaliseHandle(tab?.url || "");
}

openSettingsTab.addEventListener("click", async () => {
  openSettingsTab.disabled = true;
  try {
    const url = new URL(chrome.runtime.getURL("popup/popup.html"));
    url.searchParams.set("view", "settings");
    const searchHandle = accountList.normaliseHandle(input.value);
    if (searchHandle) url.searchParams.set("account", searchHandle);
    const handle = await activeThreadsHandle().catch(() => null);
    if (handle) url.searchParams.set("from", handle);
    await chrome.tabs.create({ url: url.href });
  } catch {
    result.textContent = "無法開啟設定分頁，請再試一次。";
  } finally {
    openSettingsTab.disabled = false;
  }
});

async function showSearchResult(query, handle) {
  const { bundledAi, manualAi, green } = await accountList.loadHandles();
  const labels = [];
  if (green.has(handle)) labels.push("白名單");
  else {
    if (bundledAi.has(handle)) labels.push("內建 AI 名單");
    if (manualAi.has(handle)) labels.push("我的 AI 標記");
  }
  const label = labels.join(" · ");
  if (input.value === query) {
    result.textContent = "@" + handle + (label ? " · " + label : " 未在名單內。");
  }
}

async function removeMark(handle, type, button) {
  button.disabled = true;
  listStatus.textContent = "";
  try {
    await accountList.remove(handle, type);
  } catch {
    button.disabled = false;
    listStatus.textContent = "移除失敗，請再試一次。";
    return;
  }
  await refreshLists();
  const query = input.value;
  if (accountList.normaliseHandle(query) === handle && result.textContent) {
    try {
      await showSearchResult(query, handle);
    } catch {
      if (input.value === query) result.textContent = "讀取名單失敗，請再試一次。";
    }
  }
}

async function refreshLists() {
  try {
    const lists = await accountList.loadManualHandles();
    for (const [type, handles] of Object.entries(lists)) {
      const list = document.querySelector("#manual-" + type);
      const rows = [...handles].sort().map(handle => {
        const row = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = "@" + handle;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "移除";
        button.setAttribute("aria-label", "移除 @" + handle);
        button.addEventListener("click", () => removeMark(handle, type, button));
        row.append(name, button);
        return row;
      });
      if (!rows.length) {
        const empty = document.createElement("li");
        empty.textContent = "尚未新增帳號";
        rows.push(empty);
      }
      list.replaceChildren(...rows);
    }
    listStatus.textContent = "";
  } catch {
    listStatus.textContent = "無法讀取個人名單，請重新開啟 Popup。";
  }
}

input.addEventListener("input", () => {
  result.textContent = "";
});

fillAccount.addEventListener("click", async () => {
  fillAccount.disabled = true;
  try {
    const handle = isSettingsTab ? sourceHandle : await activeThreadsHandle();
    if (!handle) {
      result.textContent = "請開啟 Threads 的個人檔案或貼文。";
      return;
    }
    input.value = "@" + handle;
    result.textContent = "";
    input.focus();
  } catch {
    result.textContent = "無法讀取目前的分頁，請再試一次。";
  } finally {
    fillAccount.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value;
  const handle = accountList.normaliseHandle(query);
  if (!handle) {
    result.textContent = "請輸入帳號或 Threads 網址。";
    return;
  }

  const adding = event.submitter?.value === "add";
  buttons.forEach(button => { button.disabled = true; });
  result.textContent = adding ? "儲存中…" : "查詢中…";
  try {
    if (adding) {
      await accountList.add(handle, type.value);
      await refreshLists();
    }
    await showSearchResult(query, handle);
  } catch {
    if (input.value === query) result.textContent = adding ? "無法確認新增結果，請再試一次。" : "讀取名單失敗，請再試一次。";
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});

void refreshLists();

async function initDisplaySettings() {
  const status = document.querySelector("#lookup-status");
  const allTopics = document.querySelector("#lookup-topics");
  try {
    const settings = await accountList.loadDisplaySettings();
    const fields = Object.entries(accountList.displayKeys).map(([feature, key]) => ({
      feature, key, checkbox: document.querySelector("#lookup-" + feature),
    }));
    const controls = [allTopics, ...fields.map(field => field.checkbox)];
    const render = () => {
      for (const { feature, checkbox } of fields) checkbox.checked = settings[feature];
      allTopics.checked = settings.aiThreads && settings.aiArt;
      allTopics.indeterminate = settings.aiThreads !== settings.aiArt;
    };
    const save = async changes => {
      for (const control of controls) control.disabled = true;
      status.textContent = "";
      try {
        const stored = Object.fromEntries(Object.entries(changes).map(([feature, value]) =>
          [accountList.displayKeys[feature], value]));
        await chrome.storage.local.set(stored);
        Object.assign(settings, changes);
      } catch {
        status.textContent = "無法儲存顯示設定，請再試一次。";
      } finally {
        render();
        for (const control of controls) control.disabled = false;
      }
    };
    for (const { feature, checkbox } of fields) {
      checkbox.addEventListener("change", () => save({ [feature]: checkbox.checked }));
    }
    allTopics.addEventListener("change", () => save({ aiThreads: allTopics.checked, aiArt: allTopics.checked }));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let changed = false;
      for (const { feature, key } of fields) {
        if (typeof changes[key]?.newValue !== "boolean") continue;
        settings[feature] = changes[key].newValue;
        changed = true;
      }
      if (changed) render();
    });
    render();
    for (const control of controls) control.disabled = false;
  } catch {
    status.textContent = "無法讀取顯示設定，請重新開啟 Popup。";
  }
}

void initDisplaySettings();
