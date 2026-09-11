@echo off
rem Owner walkthrough (Windows) - remove walkthrough apps and scratch state.
setlocal
cd /d E:\dev\github\opentray-orch
call pnpm --dir E:\dev\github\opentray-orch create-opentray app uninstall com.ycombinator.news
call pnpm --dir E:\dev\github\opentray-orch create-opentray app uninstall local.cmd-demo
rmdir /s /q "%USERPROFILE%\opentray-owner-walkthrough" 2>nul
echo done
