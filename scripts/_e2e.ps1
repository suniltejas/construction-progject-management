$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000/projects'
$jar = Join-Path (Get-Location) 'cookies.txt'
if (Test-Path $jar) { Remove-Item $jar -Force }

function api($method, $path, $body) {
  $args = @('-sS','-w','CODE:%{http_code}','-X',$method,'-H','Accept: application/json')
  if ($jar) { $args += @('-b',$jar,'-c',$jar) }
  if ($null -ne $body) { $args += @('-H','Content-Type: application/json','-d',$body) }
  $args += "$base$path"
  $out = & curl.exe @args
  $idx = $out.IndexOf('CODE:')
  $status = if ($idx -ge 0) { $out.Substring($idx + 5) } else { $out }
  $payload = if ($idx -ge 0) { $out.Substring(0, $idx) } else { $out }
  return @{ status = $status; payload = $payload }
}
function jb($h) { $h | ConvertTo-Json -Depth 8 -Compress }

Write-Output '=== 1. sign-in (expect 200) ==='
$r = api POST '/api/auth/sign-in/username' (jb @{ username='owner'; password='TestOwner123!' })
"  HTTP=$($r.status) user=[$((($r.payload | ConvertFrom-Json).user.username))] sessionToken=$([bool](Test-Path $jar))"

Write-Output '=== 2. session (expect user=owner) ==='
$r = api GET '/api/session'; "  HTTP=$($r.status) payload=$($r.payload)"

Write-Output '=== 3. create project (expect 201) ==='
$r = api POST '/api/projects' (jb @{ name='Riverside Medical Centre'; location='Lagos'; lead='Eng. Ada'; start='2026-01-01'; end='2026-12-31'; stage='In progress' })
"  HTTP=$($r.status) id=[$(($r.payload | ConvertFrom-Json).id)] stage=$($r.payload | ConvertFrom-Json | Select-Object -ExpandProperty stage)"
$pid = ($r.payload | ConvertFrom-Json).id

Write-Output '=== 4. create milestone (expect 201) ==='
$r = api POST '/api/milestones' (jb @{ projectId=$pid; name='Foundation'; due='2026-03-01'; status='Upcoming' })
"  HTTP=$($r.status) id=[$(($r.payload | ConvertFrom-Json).id)] due=$($r.payload | ConvertFrom-Json | Select-Object -ExpandProperty due)"
$mid = ($r.payload | ConvertFrom-Json).id

Write-Output '=== 5. create task assign to owner (expect 201) ==='
$ownerId = ((api GET '/api/session').payload | ConvertFrom-Json).user.id
$r = api POST '/api/tasks' (jb @{ projectId=$pid; milestoneId=$mid; name='Excavation'; owner='Crew A'; due='2026-02-15'; status='Not started'; priority='High'; assigneeUserIds=@($ownerId) })
"  HTTP=$($r.status) id=[$(($r.payload | ConvertFrom-Json).id)]"
$tid = ($r.payload | ConvertFrom-Json).id
"  assignees=[$(($r.payload | ConvertFrom-Json).assigneeUserIds -join ',')] owner=[$(($r.payload | ConvertFrom-Json).owner)]"

Write-Output '=== 6. create subtask under task (expect 201) ==='
$r = api POST '/api/subtasks' (jb @{ taskId=$tid; name='Survey site'; due='2026-02-10'; ownerAssigneeId=$ownerId; status='Not started' })
"  HTTP=$($r.status) payload=$($r.payload)"

Write-Output '=== 7. workspace (owner sees all) ==='
$ws = ((api GET '/api/workspace').payload | ConvertFrom-Json)
"  projects=$($ws.projects.Count) milestones=$($ws.milestones.Count) tasks=$($ws.tasks.Count) subtasks=$($ws.subtasks.Count)"
"  task0.assignees=[$($ws.tasks[0].assigneeUserIds -join ',')] owner=[$($ws.tasks[0].owner)]"

Write-Output '=== 8. NEGATIVE task w/o milestone (expect 400) ==='
$r = api POST '/api/tasks' (jb @{ projectId=$pid; milestoneId=''; name='No milestone'; due='2026-02-15' })
"  HTTP=$($r.status)"

Write-Output '=== 9. NEGATIVE duplicate pending invite same email (2nd expect 409) ==='
$r1 = api POST "/api/projects/$pid/invitations" (jb @{ username='bob.smith'; email='bob@example.com'; role='editor' })
"  invite1 HTTP=$($r1.status) id=[$(($r1.payload | ConvertFrom-Json).id)]"
$r2 = api POST "/api/projects/$pid/invitations" (jb @{ username='bob.smith'; email='bob@example.com'; role='viewer' })
"  invite2 HTTP=$($r2.status) (expect 409)"

Write-Output '=== 10. members (owner sees invited email) ==='
$mem = ((api GET "/api/projects/$pid/members").payload | ConvertFrom-Json)
"  members=$($mem.members.Count) invitations=$($mem.invitations.Count)"
if ($mem.invitations.Count -gt 0) { "  invite0.email(own sees)=$($mem.invitations[0].email) assigneeId=[$($mem.invitations[0].assigneeId)]" }

Write-Output '=== 11. NEGATIVE project edit wrong version (expect 409) ==='
$r = api PATCH "/api/projects/$pid" (jb @{ name='X'; version=999 })
"  HTTP=$($r.status)"

Write-Output '=== 12. unauth workspace (expect 401) ==='
$u = (& curl.exe -sS -w 'CODE:%{http_code}' "$base/api/workspace")
"  HTTP=$($u.Split('CODE:')[-1])"

Write-Output 'DONE'
