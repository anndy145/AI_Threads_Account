# Threads AI 帳號標記（MVP）

這個擴充功能讀取你手動維護的 `data/threads_list.txt`。如果 Threads 貼文作者在名單中，作者名稱右側會顯示一個 **AI 名單標記**。

## 安裝

### Chrome

1. 在網址列開啟 `chrome://extensions`。
2. 開啟 **開發人員模式**。
3. 按 **載入未封裝項目**，選擇包含 `manifest.json` 的專案資料夾。
4. 重新整理。

### Firefox

1. 在網址列開啟 `about:debugging#/runtime/this-firefox`。
2. 按 **載入暫用附加元件**，選擇專案內的 `manifest.json`。
3. 開啟 Threads。如果已開啟 Threads，重新整理該分頁。

#### 重新啟動 Firefox 後，需要再次載入暫用附加元件。

## 維護名單

編輯 `data/threads_list.txt`，一行一個帳號，支援下列兩種格式：

```text
https://www.threads.com/@example
@example
```

以 `#` 開頭的行會被視為註解。

儲存名單後，依瀏覽器重新載入擴充功能。

- **Chrome**：回到 `chrome://extensions`，按擴充功能卡片上的 **重新載入**。
- **Firefox**：回到 `about:debugging#/runtime/this-firefox`，按附加元件旁的 **重新載入**。

重新載入後，刷新 Threads 分頁。
