' CareerSail · 职航 — 开机自启动脚本
' 静默启动 Node.js 服务，不显示命令行窗口，不自动打开浏览器
' 用户需要时自行访问 http://localhost:8430/dashboard.html

Set WshShell = CreateObject("WScript.Shell")

' 获取脚本所在目录
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' 静默启动 Node.js 服务（隐藏窗口）
WshShell.Run "cmd /c cd /d """ & scriptDir & """ && node dashboard\server.js", 0, False