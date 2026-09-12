@echo off
rem Owner walkthrough (Windows) - launch the HN toolbar app.
rem WALK_NOPRUN=1 -> do everything except launching (headless validation).
setlocal
set DEMOS=E:\dev\github\opentray-orch\openspec\changes\add-webview-orchestration\demos
set REPO=E:\dev\github\opentray-orch
set TGZ=%USERPROFILE%\opentray-owner-walkthrough\tgz
set APP_DIR=%USERPROFILE%\.opentray\create\walk-hn-toolbar\app

if not exist "%APP_DIR%\package.json" (
  cd /d %USERPROFILE%\opentray-owner-walkthrough
  call pnpm --dir %REPO% create-opentray create --url https://news.ycombinator.com --app-id walk.hn.toolbar --app-name "HN Walkthrough" --toolbar --skip-install --pm npm --json
)
cd /d "%APP_DIR%"
node "%DEMOS%\inject-overrides.mjs"
call npm install --registry=https://registry.npmmirror.com --no-fund --no-audit
if not "%WALK_NOPRUN%"=="" (
  echo prepared ^(WALK_NOPRUN^): %APP_DIR%
) else (
  node main.mjs
)
