$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:4321"
$sup = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$emp = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Login($sess, $email) {
  Invoke-RestMethod -Uri "$base/api/login" -Method Post -WebSession $sess `
    -ContentType "application/json" -Body (@{ email = $email; password = "123456" } | ConvertTo-Json)
}

Login $sup "zhangli@ai-flows.com" | Out-Null
Login $emp "wangxinyi@ai-flows.com" | Out-Null

$list = Invoke-RestMethod -Uri "$base/api/tickets" -WebSession $sup
$tk = $list.tickets | Where-Object { $_.authorEmail -eq "zhangli@ai-flows.com" } | Select-Object -First 1
if (-not $tk) { $tk = $list.tickets | Select-Object -First 1 }
Write-Host "工单:" $tk.id $tk.title "nodeId="$tk.nodeId

# 1) 评论：纯文本 + @提及（data-email）应被保留
$body = @{ content = '<p>测试评论张莉 换行</p><br><a href="/profile/wangxinyi" data-email="wangxinyi@ai-flows.com">@王鑫易</a> 请跟进' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri "$base/api/tickets/$($tk.id)/comments" -Method Post -WebSession $emp -ContentType "application/json" -Body $body
$c = $r.ticket.commentList[-1]
Write-Host "评论落库:" $c.content

# 2) 指派负责人（主管）
$r2 = Invoke-RestMethod -Uri "$base/api/tickets/$($tk.id)/assignee" -Method Post -WebSession $sup `
  -ContentType "application/json" -Body (@{ email = "wangxinyi@ai-flows.com" } | ConvertTo-Json)
Write-Host "指派后: assigneeEmail=" $r2.ticket.assigneeEmail "assigneeName=" $r2.ticket.assigneeName

# 3) 被指派人应收到消息
$msgs = Invoke-RestMethod -Uri "$base/api/messages" -WebSession $emp
Write-Host "王鑫易未读数:" $msgs.unread " 首条:" ($msgs.messages | Select-Object -First 1).title

# 4) 员工无指派权限
try {
  Invoke-RestMethod -Uri "$base/api/tickets/$($tk.id)/assignee" -Method Post -WebSession $emp `
    -ContentType "application/json" -Body (@{ email = "chenyu@ai-flows.com" } | ConvertTo-Json) | Out-Null
  Write-Host "!! 员工指派未被拦截"
} catch {
  Write-Host "员工指派被拦截: HTTP" $_.Exception.Response.StatusCode.value__
}

# 5) 工单详情带负责人字段
$d = Invoke-RestMethod -Uri "$base/api/tickets/$($tk.id)" -WebSession $sup
Write-Host "详情负责人:" $d.ticket.assigneeName " 评论数:" $d.ticket.commentList.Count

# 6) 页面与静态资源可达
foreach ($p in @("/messages", "/messages.js", "/tickets", "/tickets.js", "/user-menu.js")) {
  $resp = Invoke-WebRequest -Uri "$base$p" -WebSession $sup -UseBasicParsing
  Write-Host ("{0} -> {1} ({2} bytes)" -f $p, $resp.StatusCode, $resp.RawContentLength)
}