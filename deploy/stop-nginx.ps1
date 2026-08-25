# ===== إيقاف nginx المحلي =====
param([string]$NginxDir = 'C:\tools\nginx')
$pidFile = Join-Path $NginxDir 'logs\nginx.pid'
$stopped = $false

# 1) إيقاف رشيق عبر إشارة الماستر (يوقف الشجرة: master + worker)
if (Test-Path $pidFile) {
  $nginxPid = [int](Get-Content $pidFile | Select-Object -First 1)
  if (Get-Process -Id $nginxPid -ErrorAction SilentlyContinue) {
    & "$NginxDir\nginx.exe" -s stop -p "$NginxDir/"
    Start-Sleep -Seconds 2
    if (-not (Get-Process -Id $nginxPid -ErrorAction SilentlyContinue)) {
      Write-Host "nginx (PID $nginxPid) أوقف" -ForegroundColor Yellow
      $stopped = $true
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# 2) بديل: إيقاف أي عمليات nginx يتيمة بقيت معلقة
if (-not $stopped) {
  $orphans = Get-Process nginx -ErrorAction SilentlyContinue
  if ($orphans) {
    $orphans | Stop-Process -Force
    Write-Host "أوقفت عمليات nginx اليتيمة: $($orphans.Id -join ', ')" -ForegroundColor Yellow
    $stopped = $true
  }
}

if (-not $stopped) { Write-Host 'لا يوجد nginx يعمل' -ForegroundColor DarkGray }
