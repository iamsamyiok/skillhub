# recorder2skill — install notes

This skill drives the recorder2skill recorder + CLI. The CLI lives in its own
repo and must be available before recording:

```bash
git clone https://github.com/iamsamyiok/recorder2skill.git
cd recorder2skill
./scripts/setup.sh        # Windows: scripts/setup.ps1
node scripts/recorder-cli.mjs doctor   # all checks green = ready
```

Then copy this skill folder into your agent's skills directory:

```bash
# OpenCode
cp -r recorder2skill  yourproject/.opencode/skill/
# Claude Code
cp -r recorder2skill  yourproject/.claude/skills/
```

Full docs: https://github.com/iamsamyiok/recorder2skill
