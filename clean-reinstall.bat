@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 绘台 - Docker 干净重装

set "APPVER=未知"
for /f "tokens=2 delims== " %%v in ('findstr /b /c:"VERSION = " app\config.py 2^>nul') do set "APPVER=%%~v"
set "IMGTAR=huitai-v%APPVER%-amd64.tar"
set "LOG=clean-reinstall.log"

echo ============================================
echo   绘台 Docker 干净重装  目标版本 v%APPVER%
echo ============================================
echo.
echo [提示] 只清理容器 / 镜像 / 网络 / 旧字节码；
echo        data\ 与 output\ 里的数据库、账号、图片、成品全部保留。
echo.
echo ===== %date% %time% 开始，目标版本 %APPVER% =====>>"%LOG%"

rem ---- 1. 已有数据：只报告，全部保留 ----
if exist "data" (
  echo [1/4] 检测到已有 data\，全部保留
  echo 检测到已有 data\，全部保留>>"%LOG%"
) else (
  echo [1/4] 未检测到旧数据，按全新部署处理
)

rem ---- 2. 运行态清理 ----
echo [2/4] 清理旧容器 / 旧镜像 / 残留网络...
docker info >nul 2>&1
if errorlevel 1 (
  echo       Docker 未运行，跳过运行态清理。请先启动 Docker Desktop。
  echo Docker 未运行，跳过运行态清理>>"%LOG%"
  goto :files
)
if exist "docker-compose.yml" docker compose down --remove-orphans >nul 2>&1
for /f "delims=" %%c in ('docker ps -a --filter name^=huitai --filter name^=image-workbench --format "{{.Names}}" 2^>nul') do (
  echo       清理旧容器 %%c
  echo 清理旧容器 %%c>>"%LOG%"
  docker rm -f "%%c" >nul 2>&1
)
for /f "delims=" %%i in ('docker images --filter^=reference^=huitai --format "{{.Repository}}:{{.Tag}}" 2^>nul') do (
  echo       清理旧镜像 %%i
  echo 清理旧镜像 %%i>>"%LOG%"
  docker rmi -f "%%i" >nul 2>&1
)
for /f "delims=" %%n in ('docker network ls --filter name^=huitai --format "{{.Name}}" 2^>nul') do (
  docker network rm "%%n" >nul 2>&1 && (echo       清理旧网络 %%n & echo 清理旧网络 %%n>>"%LOG%")
)

:files
rem ---- 3. 旧程序文件清理（只清字节码与上一版镜像 tar）----
echo [3/4] 清理旧程序文件...
if exist "app" (
  for /d /r "app" %%d in (__pycache__) do if exist "%%d" rd /s /q "%%d" 2>nul
  del /s /q "app\*.pyc" >nul 2>&1
  del /s /q "app\*.pyo" >nul 2>&1
)
for %%f in (huitai-v*-amd64.tar) do (
  if not "%%f"=="%IMGTAR%" (
    echo       清理旧版镜像文件 %%f
    echo 清理旧版镜像文件 %%f>>"%LOG%"
    del /q "%%f" >nul 2>&1
  )
)
echo       旧字节码与旧版 tar 已清理，用户数据全部保留
echo 旧程序文件清理完成，用户数据全部保留>>"%LOG%"

if "%~1"=="--clean" (
  echo.
  echo 仅清理模式，结束。手动启动：docker compose up -d
  pause
  exit /b 0
)

rem ---- 4. 重新拉起 ----
echo [4/4] 重新拉起容器...
docker info >nul 2>&1
if errorlevel 1 (
  echo       Docker 未运行，未启动。请启动 Docker Desktop 后执行 docker compose up -d
  pause
  exit /b 1
)
if exist "%IMGTAR%" (
  echo       导入离线镜像 %IMGTAR%
  docker load -i "%IMGTAR%" >nul 2>&1
)
docker image inspect "huitai:%APPVER%" >nul 2>&1
if errorlevel 1 (
  echo       本地构建镜像 huitai:%APPVER%
  docker compose build
)
docker compose up -d
if errorlevel 1 (
  echo [错误] 启动失败，请查看上方输出与 %LOG%
  pause
  exit /b 1
)
echo.
echo 完成。浏览器打开 http://localhost:7401 ，顶栏应显示 v%APPVER%
echo 完成，目标版本 %APPVER%>>"%LOG%"
pause