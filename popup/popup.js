const form = document.querySelector("#account-search");
const input = document.querySelector("#account");
const result = document.querySelector("#search-result");
const buttons = form.querySelectorAll("button");
const type = document.querySelector("#account-type");

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
    if (adding) await accountList.add(handle, type.value);
    const { ai, green } = await accountList.loadHandles();
    const labels = [];
    if (ai.has(handle)) labels.push("AI 帳號");
    if (green.has(handle)) labels.push("白名單");
    if (input.value === query) result.textContent = "@" + handle
      + (labels.length ? " · " + labels.join("、") : " 未在名單內。");
  } catch {
    if (input.value === query) result.textContent = adding ? "無法確認新增結果，請再試一次。" : "讀取名單失敗，請再試一次。";
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});
