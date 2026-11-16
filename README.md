# Threads AI 帳號標記

## 為甚麼做這個專案

Instagram已經[明確規定](https://creators.instagram.com/blog/ai-generated-profile-label)如果是AI生成的個人資料，必須要標註為AI生成的個人檔案。但是我看到Threads上看到很多帳號開patreon卻都不明確標示自己是AI生成的人物，所以我才做了這個專案，還有偷懶滑Threads的時候假裝有在做專案。

目前這個擴充功能是我手動維護的清單: [`threads_list`](https://github.com/anndy145/AI_Threads_Account/blob/main/data/threads_list.txt)。如果 Threads 貼文作者在名單中，作者名稱右側會顯示一個 **AI 名單標記**。  
此外我也做了顯示這個帳號的所在地的功能。

AI相片檢測是用:

- https://synthid.com/
- https://openai.com/zh-Hant/research/verify/

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
