(() => {
  const backupVersion = 1;
  const maxFileBytes = 1024 * 1024;
  const backupSettingNames = {
    location: "showLocation",
    aiThreads: "showAiThreads",
    aiArt: "showAiArt",
    allowlist: "showAllowlist",
    manualAi: "showManualAi",
    bundledAi: "showBundledAi",
  };
  const exportButton = document.querySelector("#backup-export");
  const fileInput = document.querySelector("#backup-file");
  const options = document.querySelector("#backup-options");
  const preview = document.querySelector("#backup-preview");
  const mode = document.querySelector("#backup-mode");
  const importButton = document.querySelector("#backup-import");
  const status = document.querySelector("#backup-status");
  let pending;
  let fileRevision = 0;

  function readHandles(values) {
    if (!Array.isArray(values)) throw new Error("備份缺少個人名單。");
    const handles = new Set();
    for (const value of values) {
      if (typeof value !== "string" || !/^[a-z0-9._-]+$/i.test(value)) {
        throw new Error("備份包含格式不正確的帳號。");
      }
      handles.add(value.toLowerCase());
    }
    return handles;
  }

  function parseBackup(text) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error("無法解析 JSON 備份檔。");
    }
    if (backup?.version !== backupVersion) throw new Error("不支援這個備份版本。");
    const allowlist = readHandles(backup.lists?.allowlist);
    const manualAi = readHandles(backup.lists?.manualAi);
    if ([...allowlist].some(handle => manualAi.has(handle))) {
      throw new Error("備份中的同一帳號不能同時有兩種標記。");
    }
    const settings = {};
    for (const [feature, name] of Object.entries(backupSettingNames)) {
      if (feature === "bundledAi" && !Object.hasOwn(backup.settings ?? {}, name)) continue;
      const value = backup.settings?.[name];
      if (typeof value !== "boolean") throw new Error("備份的顯示設定不完整或格式不正確。");
      settings[feature] = value;
    }
    if (Object.hasOwn(backup.settings, "theme")) {
      const theme = backup.settings.theme;
      if (!accountList.themeModes.includes(theme)) throw new Error("備份中的明暗模式不正確。");
      settings.theme = theme;
    }
    return { lists: { allowlist, manualAi }, settings };
  }

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    status.textContent = "";
    try {
      const [lists, settings, theme] = await Promise.all([
        accountList.loadManualHandles(), accountList.loadDisplaySettings(), accountList.loadTheme(),
      ]);
      const backup = {
        version: backupVersion,
        lists: { allowlist: [...lists.green].sort(), manualAi: [...lists.ai].sort() },
        settings: {
          ...Object.fromEntries(Object.entries(backupSettingNames).map(([feature, name]) =>
            [name, settings[feature]])),
          theme,
        },
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2) + "\n"], {
        type: "application/json",
      }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "threads-marker-backup.json";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      status.textContent = "無法匯出備份，請再試一次。";
    } finally {
      exportButton.disabled = false;
    }
  });

  fileInput.addEventListener("change", async () => {
    const revision = ++fileRevision;
    const [file] = fileInput.files;
    pending = null;
    options.hidden = true;
    status.textContent = "";
    if (!file) return;
    if (file.size > maxFileBytes) {
      status.textContent = "備份檔案不可超過 1 MB。";
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      if (revision === fileRevision) status.textContent = "無法讀取備份檔案。";
      return;
    }
    if (revision !== fileRevision) return;
    try {
      pending = parseBackup(text);
      preview.textContent = "白名單：" + pending.lists.allowlist.size + " 個帳號，AI 標記："
        + pending.lists.manualAi.size + " 個帳號";
      mode.value = "merge";
      options.hidden = false;
    } catch (error) {
      status.textContent = error.message;
    }
  });

  importButton.addEventListener("click", async () => {
    if (!pending) return;
    importButton.disabled = fileInput.disabled = mode.disabled = exportButton.disabled = true;
    status.textContent = "";
    try {
      await accountList.restorePersonalData(pending.lists, pending.settings, mode.value === "replace");
      pending = null;
      fileInput.value = "";
      options.hidden = true;
      status.textContent = "已匯入個人名單和顯示設定。";
      await refreshLists();
      const query = input.value;
      const handle = accountList.normaliseHandle(query);
      if (handle && result.textContent) {
        try {
          await showSearchResult(query, handle);
        } catch {
          if (input.value === query) result.textContent = "讀取名單失敗，請再試一次。";
        }
      }
    } catch {
      status.textContent = "無法匯入備份，請再試一次。";
    } finally {
      importButton.disabled = fileInput.disabled = mode.disabled = exportButton.disabled = false;
    }
  });
})();
