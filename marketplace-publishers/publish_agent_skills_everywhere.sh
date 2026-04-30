#!/usr/bin/env bash
set -euo pipefail

# Publish/submit SKILL.md packages to known agent-skill marketplaces.
# Requires: gh, git, node/npm. Optional: browser profile login for AgentHub/ClawMart.
# Secrets must be supplied via env vars; this script never prints API keys.

ROOT_REPO="${ROOT_REPO:-https://github.com/ralyodio/agent-skills}"
OWNER="${OWNER:-ralyodio}"
WORKDIR="${WORKDIR:-/tmp/agent-skill-marketplace-submit}"
mkdir -p "$WORKDIR"

submit_kilo() {
  local dir="$WORKDIR/kilo-marketplace"
  rm -rf "$dir"
  gh repo fork Kilo-Org/kilo-marketplace --clone=true --remote=true -- "${dir}" >/dev/null
  cd "$dir"
  git checkout -b "add-${OWNER}-job-automation-skills"
  npm install gray-matter js-yaml tsx >/dev/null
  for slug in dice-easy-apply-automation linkedin-easy-apply-automation promote-skill; do
    npx tsx bin/add-remote-skill.ts "${ROOT_REPO}/tree/main/skills/${slug}"
  done
  git add skills
  git commit -m "Add ${OWNER} job automation skills" || true
  git push -u origin "add-${OWNER}-job-automation-skills"
  gh pr create --repo Kilo-Org/kilo-marketplace --head "${OWNER}:add-${OWNER}-job-automation-skills" --base main --title "Add ${OWNER} job automation skills" --body "Adds three externally hosted SKILL.md skills. Source: ${ROOT_REPO}" || true
  gh pr list --repo Kilo-Org/kilo-marketplace --author "$OWNER" --head "${OWNER}:add-${OWNER}-job-automation-skills" --json number,title,url,state --limit 5
}

submit_skillstore() {
  local dir="$WORKDIR/aiskillstore-marketplace"
  rm -rf "$dir"
  gh repo fork aiskillstore/marketplace --clone=true --remote=true -- "$dir" >/dev/null
  cd "$dir"
  git checkout -b "add-${OWNER}-job-automation-skills"
  mkdir -p skills/${OWNER}/{dice-easy-apply-automation,linkedin-easy-apply-automation,promote-skill}
  cp /tmp/dice-easy-apply-public-SKILL.md skills/${OWNER}/dice-easy-apply-automation/SKILL.md
  cp /tmp/linkedin-easy-apply-public-SKILL.md skills/${OWNER}/linkedin-easy-apply-automation/SKILL.md
  cp /tmp/promote-skill-public-SKILL.md skills/${OWNER}/promote-skill/SKILL.md
  python3 - <<'PY'
import json, pathlib, os
owner=os.environ.get('OWNER','ralyodio')
for slug in ['dice-easy-apply-automation','linkedin-easy-apply-automation','promote-skill']:
    p=pathlib.Path('skills')/owner/slug/'skill-report.json'
    p.write_text(json.dumps({'status':'pending-review','source':f'https://github.com/{owner}/agent-skills/tree/main/skills/{slug}','submittedBy':owner}, indent=2)+'\n')
PY
  git add "skills/${OWNER}"
  git commit -m "Add ${OWNER} job automation skills" || true
  git push -u origin "add-${OWNER}-job-automation-skills"
  gh pr create --repo aiskillstore/marketplace --head "${OWNER}:add-${OWNER}-job-automation-skills" --base main --title "Add ${OWNER} job automation skills" --body "Adds three public credential-free SKILL.md skills for Skillstore review. Source: ${ROOT_REPO}" || true
  gh pr list --repo aiskillstore/marketplace --author "$OWNER" --head "${OWNER}:add-${OWNER}-job-automation-skills" --json number,title,url,state --limit 5
}

submit_moltbook_issue() {
  local body="$WORKDIR/moltbook-issue.md"
  cat > "$body" <<EOF
Request to add/index three public AI agent skills.

Canonical multi-skill repository: ${ROOT_REPO}

Skills:
- ${ROOT_REPO}/tree/main/skills/dice-easy-apply-automation
- ${ROOT_REPO}/tree/main/skills/linkedin-easy-apply-automation
- ${ROOT_REPO}/tree/main/skills/promote-skill
EOF
  gh issue create --repo Moltbook-Official/moltbook --title "Index ${OWNER} agent skills" --body-file "$body" || true
  gh issue list --repo Moltbook-Official/moltbook --author "$OWNER" --json number,title,url,state --limit 10
}

submit_agenthub() {
  # Requires prior login/email confirmation in profile /home/ettinger/.cache/hermes-agenthub-chrome.
  NODE_PATH=/home/ettinger/Desktop/resume/node_modules xvfb-run -a node /tmp/agenthub_submit.cjs "$ROOT_REPO"
}

publish_clawmart() {
  # Requires CLAWMART_API_KEY and paid creator membership.
  node /home/ettinger/Desktop/resume/marketplace-publishers/clawmart_publish.cjs
}

case "${1:-all}" in
  kilo) submit_kilo ;;
  skillstore) submit_skillstore ;;
  moltbook) submit_moltbook_issue ;;
  agenthub) submit_agenthub ;;
  clawmart) publish_clawmart ;;
  all)
    submit_kilo
    submit_skillstore
    submit_moltbook_issue
    submit_agenthub || true
    publish_clawmart || true
    ;;
  *) echo "Usage: $0 {all|kilo|skillstore|moltbook|agenthub|clawmart}" >&2; exit 2 ;;
esac
