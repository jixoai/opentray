@echo off
rem Owner walkthrough (Windows) - command app with local service + toolbar.
rem WALK_NOPRUN=1 -> do everything except launching.
setlocal
set DEMOS=E:\dev\github\opentray-orch\openspec\changes\add-webview-orchestration\demos
set REPO=E:\dev\github\opentray-orch
set TGZ=%USERPROFILE%\opentray-owner-walkthrough\tgz
set APP_DIR=%USERPROFILE%\.opentray\create\walk-cmd-demo\app

mkdir "%USERPROFILE%\opentray-owner-walkthrough\cmd-content" 2>nul
echo ^<!doctype html^>^<title^>Cmd Service^>^<h1^>win cmd^</h1^> > "%USERPROFILE%\opentray-owner-walkthrough\cmd-content\index.html"
if not exist "%APP_DIR%\package.json" (
  cd /d %USERPROFILE%\opentray-owner-walkthrough
  call pnpm --dir %REPO% create-opentray create --app-id walk.cmd.demo --app-name "Cmd Walkthrough" --exec python --arg=-m --arg=http.server --arg=8137 --cwd "%USERPROFILE%\opentray-owner-walkthrough\cmd-content" --toolbar --skip-install --pm npm --json
)
cd /d "%APP_DIR%"
node "%DEMOS%\inject-overrides.mjs"
call npm install --registry=https://registry.npmmirror.com --no-fund --no-audit
if not "%WALK_NOPRUN%"=="" (
  echo prepared ^(WALK_NOPRUN^): %APP_DIR%
) else (
  node main.mjs
)
