; ai-group-chat 的 Windows 安装包（TASK-012）。未在真机验证；由 CI 的 windows-2022 runner 用 makensis 构建。
; 调用：makensis -DSRC=<bin目录> -DWEBVIEW2=<bootstrapper路径> -DOUT=<输出 setup.exe> installer.nsi
; WebView2 缺失时运行固定 Wails CLI 附带的在线引导程序；失败时中止安装。

!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "ai-group-chat"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\ai-group-chat"
RequestExecutionLevel user
Unicode true

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "安装"
  SetShellVarContext current
  ; 对齐 Wails 官方安装器的用户/系统检测，避免已有运行时仍重复安装。
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $1 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${AndIf} $1 == ""
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=MicrosoftEdgeWebview2Setup.exe "${WEBVIEW2}"
    DetailPrint "正在安装 WebView2 Runtime（需要网络）"
    ClearErrors
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $0
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "无法启动 WebView2 安装程序。请重试。"
      Abort
    ${EndIf}
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "WebView2 安装失败（代码 $0）。请检查网络后重试。"
      Abort
    ${EndIf}
  ${EndIf}
  SetOutPath "$INSTDIR"
  File "${SRC}\ai-group-chat.exe"
  CreateShortcut "$SMPROGRAMS\ai-group-chat.lnk" "$INSTDIR\ai-group-chat.exe"
  CreateShortcut "$DESKTOP\ai-group-chat.lnk" "$INSTDIR\ai-group-chat.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$INSTDIR\ai-group-chat.exe"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\ai-group-chat.lnk"
  Delete "$DESKTOP\ai-group-chat.lnk"
  RMDir "$INSTDIR"
SectionEnd
