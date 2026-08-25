# ===== تحقق نهاية-لنهاية من النشر المحلي =====
# يفحص: وصول كل واجهة + بروكسي /api (login + التقرير المالي الجديد) + رؤوس الأمان + الكاش.
$ErrorActionPreference = 'Continue'
$apps = @(
  @{ name = 'الزبون';  port = 8081 },
  @{ name = 'الوكيل';  port = 8082 },
  @{ name = 'المسؤول'; port = 8083 },
  @{ name = 'المزود';  port = 8084 }
)
$fail = 0

foreach ($a in $apps) {
  $base = "http://localhost:$($a.port)"
  try {
    $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 10
    $csp = $r.Headers['Content-Security-Policy']
    $nosniff = $r.Headers['X-Content-Type-Options']
    $ok = ($r.StatusCode -eq 200) -and $csp -and $nosniff
    if (-not $ok) { $fail++ }
    "{0}: index 200={1} CSP={2} nosniff={3}" -f $a.name, ($r.StatusCode -eq 200), [bool]$csp, [bool]$nosniff
  } catch { $fail++; "{0}: فشل — {1}" -f $a.name, $_.Exception.Message }
}

# كاش الأصول المبعثرة (مستوى location له رؤوسه الخاصة — يجب أن تحتفظ برؤوس الأمان)
$asset = (Get-Content 'D:\1h1h\customer-mobile\dist\index.html' -Raw) -match 'assets/[^" ]+\.js'
if ($asset) {
  $js = [regex]::Match((Get-Content 'D:\1h1h\customer-mobile\dist\index.html' -Raw), 'assets/[^" ]+\.js').Value
  $r = Invoke-WebRequest -Uri "http://localhost:8081/$js" -UseBasicParsing -TimeoutSec 10
  "{0}: cache={1} nosniff={2}" -f $js, $r.Headers['Cache-Control'], [bool]$r.Headers['X-Content-Type-Options']
  if (-not $r.Headers['X-Content-Type-Options']) { $fail++ }
}

# بروكسي API عبر nginx: login مسؤول ثم التقرير المالي الجديد + التصدير
try {
  $login = Invoke-RestMethod -Uri 'http://localhost:8083/api/auth/login' -Method Post -ContentType 'application/json' -Body '{"email":"admin@rafidain.iq","password":"Admin@123","role":"admin"}' -TimeoutSec 10
  $h = @{ Authorization = "Bearer $($login.data.token)" }
  $fr = Invoke-RestMethod -Uri 'http://localhost:8083/api/financial-report?group_by=month' -Headers $h -TimeoutSec 10
  $exp = Invoke-WebRequest -Uri 'http://localhost:8083/api/financial-report/export?group_by=month' -Headers $h -UseBasicParsing -TimeoutSec 10
  "proxy api: login ok · financial-report rows=$($fr.data.rows.Count) · export=$($exp.StatusCode)"
} catch { $fail++; "proxy api: فشل — $($_.Exception.Message)" }

if ($fail -gt 0) { Write-Host "نتيجة: $fail فشل" -ForegroundColor Red; exit 1 }
Write-Host 'نتيجة: كل الفحوصات نجحت' -ForegroundColor Green
