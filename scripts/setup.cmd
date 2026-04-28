@echo off
REM opencode-openauto setup — Windows wrapper.
REM Registers the plugin and the OpenAuto Router provider in
REM %APPDATA%\opencode\opencode.json so the model picker lists OpenAuto.
REM
REM Usage:
REM   scripts\setup.cmd
REM   scripts\setup.cmd --port=4318
node "%~dp0..\dist\cli\index.js" setup %*
