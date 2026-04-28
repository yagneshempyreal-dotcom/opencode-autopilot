@echo off
REM opencode-openauto refresh — Windows wrapper.
REM Kills running opencode, clears plugin / bun caches, prints next steps.
REM
REM Usage:
REM   scripts\refresh.cmd
REM   scripts\refresh.cmd --yes
node "%~dp0..\dist\cli\index.js" refresh %*
