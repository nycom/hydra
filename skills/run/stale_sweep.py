"""Find and kill stale background tasks left by delegation agents.

Kills: (1) wait loops (`while pgrep -f X` / `until ! pgrep -f X`) older than 60 s whose target X
matches no process except the loops, pgrep and sleep — pgrep -f matches the loop's own shell
line, so these never exit; (2) orphaned (ppid 1) test runners older than 2 h whose cwd is inside an
agent worktree (.claude/worktrees/), so a server the user started with nohup is never killed.
Reports other runners older than 3 h; never kills those.
Usage: python3 stale_sweep.py [--dry-run | --self-test]
"""
import os, re, signal, subprocess, sys

RUNNER = re.compile(r"pytest|surefire|plexus-classworlds|launcher\.Launcher|playwright|vitest|java .*-jar ")
LOOP = re.compile(r"(?:while|until !) pgrep -f ([\"'])(.+?)\1")


def secs(etime):
    days, _, rest = etime.partition("-") if "-" in etime else ("0", "", etime)
    parts = [int(p) for p in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, s = parts
    return int(days) * 86400 + h * 3600 + m * 60 + s


def procs(out=None):
    if out is None:
        out = subprocess.run(["ps", "-axo", "pid=,ppid=,etime=,command="], capture_output=True, text=True).stdout
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:  # zombies and kernel tasks can print no command
            pid, ppid, et, cmd = parts
            yield int(pid), int(ppid), secs(et), cmd


def proc_cwd(pid):
    out = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True).stdout
    return next((l[1:] for l in out.splitlines() if l.startswith("n")), "")


def classify(ps, cwd=proc_cwd):
    """ps: [(pid, ppid, age_s, cmd)] -> (kill [(proc, why)], report [proc])."""
    loops = [(p, LOOP.search(p[3])) for p in ps if LOOP.search(p[3])]
    loop_pids = {p[0] for p, _ in loops}
    kill, report = [], []
    for p, m in loops:
        try:
            rx = re.compile(m.group(2))
        except re.error:  # pgrep ERE Python can't parse: leave that loop alone, sweep the rest
            continue
        live = [q for q in ps if q[0] not in loop_pids and "pgrep" not in q[3] and "sleep" != q[3].split()[0] and rx.search(q[3])]
        if not live and p[2] > 60:
            kill.append((p, f"wait loop on '{m.group(2)}' with no target"))
    for p in ps:
        if p[0] in loop_pids or not RUNNER.search(p[3]) or "stale_sweep" in p[3]:
            continue
        if p[1] == 1 and p[2] > 7200 and "/.claude/worktrees/" in cwd(p[0]):
            kill.append((p, "orphaned test runner in an agent worktree"))
        elif p[2] > 10800:
            report.append(p)
    return kill, report


def self_test():
    assert secs("05") == 5 and secs("01:02") == 62 and secs("1:00:00") == 3600 and secs("2-00:00:01") == 172801
    loop = (10, 9, 600, '/bin/zsh -c while pgrep -f "mvnw|maven" >/dev/null; do sleep 5; done')
    young = (11, 9, 30, "zsh -c until ! pgrep -f 'launcher.Launcher -B test'; do sleep 5; done")
    sleep = (12, 10, 1, "sleep 5")
    kill, _ = classify([loop, young, sleep], cwd=lambda pid: "")
    assert [p[0] for p, _ in kill] == [10], kill  # stuck loop dies, <60 s loop spared
    mvn = (20, 1, 30, "java -cp /opt/homebrew/Cellar/maven/3.9.9/boot/plexus-classworlds.jar org.codehaus.plexus.classworlds.launcher.Launcher -B test")
    kill, _ = classify([loop, mvn], cwd=lambda pid: "")
    assert kill == [], kill  # target alive -> loop is legitimately waiting
    orphan = (30, 1, 24 * 86400, "python -m pytest tests/")
    owned = (31, 500, 4 * 3600, "node vitest run")
    fresh_orphan = (32, 1, 3600, "npx playwright test")
    nohup_jar = (33, 1, 24 * 86400, "java -jar app.jar")  # the user's own server, cwd outside worktrees
    cwds = {30: "/r/App/.claude/worktrees/w-fix1", 33: "/r/App"}
    kill, report = classify([orphan, owned, fresh_orphan, nohup_jar], cwd=lambda pid: cwds.get(pid, ""))
    assert [p[0] for p, _ in kill] == [30] and [p[0] for p in report] == [31, 33], (kill, report)
    bad = (40, 9, 600, "zsh -c while pgrep -f 'a(b' >/dev/null; do sleep 5; done")
    kill, _ = classify([bad, loop], cwd=lambda pid: "")
    assert [p[0] for p, _ in kill] == [10], kill  # unparseable target skipped, the rest still swept
    assert list(procs("  7     1 \n12 1 05 sleep 5\n")) == [(12, 1, 5, "sleep 5")]
    print("self-test ok")


def main(dry):
    me = os.getpid()
    kill, report = classify([p for p in procs() if p[0] != me])
    for (pid, ppid, s, cmd), why in kill:
        print(f"{'WOULD KILL' if dry else 'KILLED'} {pid} ({why}, {s // 60} min): {cmd[:140]}")
        if not dry:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for pid, ppid, s, cmd in report:
        print(f"LONG-RUNNING {pid} ppid={ppid} {s // 60} min: {cmd[:140]}")
    if not kill and not report:
        print("clean")


if __name__ == "__main__":
    self_test() if "--self-test" in sys.argv else main("--dry-run" in sys.argv)
