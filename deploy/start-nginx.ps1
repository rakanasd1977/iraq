# ===== تشغيل nginx محلي لاختبار النشر =====
# الاستخدام:  powershell -ExecutionPolicy Bypass -File deploy/start-nginx.ps1
# المتطلب: nginx مثبت في $NginxDir (الافتراضي C:\tools\nginx) والمنافذ 8081-8084 حرة.
param(
  [string]$NginxDir = 'C:\tools\nginx',
  [switch]$NoVerify
)
$ErrorActionPreference = 'Stop'
$Conf = (Join-Path $PSScriptRoot 'nginx.local.conf')
$PidFile = Join-Path $NginxDir 'logs\nginx.pid'

if (-not (Test-Path "$NginxDir\nginx.exe")) { throw "nginx غير موجود في $NginxDir" }
if (Test-Path $PidFile) {
  $old = Get-Content $PidFile | Select-Object -First 1
  if (Get-Process -Id $old -ErrorAction SilentlyContinue) {
    Write-Host "nginx يعمل بالفعل (PID $old)" -ForegroundColor Yellow
    if (-not $NoVerify) { & (Join-Path $PSScriptRoot 'verify-nginx.ps1') }
    exit 0
  }
}

# تحقق من الإعداد أولاً
& "$NginxDir\nginx.exe" -t -c $Conf -p "$NginxDir/"
if ($LASTEXITCODE -ne 0) { throw 'فشل اختبار إعداد nginx' }

# تشغيل مفصول (بدون نافذة) — بدون -g pid حتى لا تتفكك الحجة عبر Start-Process
Start-Process -FilePath "$NginxDir\nginx.exe" -ArgumentList "-c `"$Conf`" -p `"$NginxDir/`"" -WorkingDirectory $NginxDir -WindowStyle Hidden
Start-Sleep -Seconds 2
Write-Host "nginx يعمل — الزبون http://localhost:8081 · الوكيل 8082 · المسؤول 8083 · المزود 8084" -ForegroundColor Green

if (-not $NoVerify) { & (Join-Path $PSScriptRoot 'verify-nginx.ps1') }
