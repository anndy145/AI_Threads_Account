const form = document.querySelector("#account-search");
const input = document.querySelector("#account");
const result = document.querySelector("#search-result");
const buttons = form.querySelectorAll("button");
const type = document.querySelector("#account-type");
const listStatus = document.querySelector("#list-status");

async function showSearchResult(query, handle) {
  const { ai, green } = await accountList.loadHandles();
  const label = green.has(handle) ? "白名單" : ai.has(handle) ? "AI 帳號" : "";
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
