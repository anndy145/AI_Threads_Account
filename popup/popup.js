const form = document.querySelector("#account-search");
const input = document.querySelector("#account");
const result = document.querySelector("#search-result");
const button = form.querySelector("button");

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

  button.disabled = true;
  result.textContent = "查詢中…";
  try {
    const handles = await accountList.loadHandles();
    if (input.value === query) {
      result.textContent = "@" + handle + (handles.has(handle) ? " 在名單內。" : " 未在名單內。");
    }
  } catch {
    if (input.value === query) result.textContent = "讀取名單失敗，請再試一次。";
  } finally {
    button.disabled = false;
  }
});
