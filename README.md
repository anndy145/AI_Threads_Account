# Threads AI 帳號標記（MVP）

這是一個 Chrome / Edge Manifest V3 擴充功能。它會讀取專案內的 `threads_list.txt`，在 Threads 上替名單中的帳號連結加入 **AI 名單標記**。

> 這是人工維護名單，不是 AI 自動偵測或事實判定工具。

## 安裝

1. 開啟 `chrome://extensions`（Edge 可開啟 `edge://extensions`）。
2. 開啟右上角的「開發人員模式」。
3. 按「載入未封裝項目」，選擇此專案資料夾：`D:\project\FakeProfileOnThreads`。
4. 開啟或重新整理 `https://www.threads.com/`。

## 維護名單

編輯 `threads_list.txt`，一行一個帳號，支援下列兩種格式：

```text
https://www.threads.com/@example
@example
```

修改名單後，回到擴充功能管理頁按「重新載入」，並重新整理 Threads 分頁。

以 `#` 開頭的行會被視為註解。
