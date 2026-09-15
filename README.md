# 福岡六日 · 隨身 App

離線可用的 PWA。開發用 `serve.ps1` 或 `python -m http.server 8080` 開，
正式站是 GitHub Pages。

## 開發

- 一般開發：`http://localhost:8080/`（**不會**註冊 Service Worker）
- 測離線：`http://localhost:8080/?sw=1`（註冊 SW；再到 DevTools 勾 Offline）

## 發佈流程

1. 改 `sw.js` 的 `APP_VERSION` 尾碼 +1，`version.json` 的 `app` 同步、`data` 填當下時間；動到新檔案就補進 `SHELL_ASSETS`
2. `git push`（GitHub Pages 一分鐘左右生效）
3. 等生效後在手機上開一次 App，看到「行程有更新」提示條點下去

**票券資料只在裝置端，不會進 repo**——`#/tools/tickets` 存的確認編號、電子票、票券圖片全部走 IndexedDB。
GitHub Pages 是公開站，任何被 `git add` 進來的檔案都會公開。
