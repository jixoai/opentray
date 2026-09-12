@echo off
rem Owner walkthrough (Windows) - one-time preparation (idempotent): pack tarballs.
setlocal
cd /d E:\dev\github\opentray-orch
mkdir "%USERPROFILE%\opentray-owner-walkthrough\tgz" 2>nul
rem Rebuild dist before packing (stale dist ships an old facade; 8.5 friction).
call pnpm -F @opentray/spec -F @opentray/ext-webview -F opentray run build
for %%p in (opentray @opentray/spec @opentray/packaging @opentray/icon @opentray/darwin-arm64 @opentray/windows-x64 @opentray/ext-webview @opentray/ext-webview-darwin-arm64 @opentray/ext-webview-windows-x64) do (
  call pnpm -F %%p pack --pack-destination "%USERPROFILE%\opentray-owner-walkthrough\tgz" >nul
)
dir /b "%USERPROFILE%\opentray-owner-walkthrough\tgz"
