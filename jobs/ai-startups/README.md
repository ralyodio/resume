# AI-startup job sweep

Finds remote, US-eligible agentic / AI-coding engineering roles at the companies in
[awesome-ai-startups-hiring](https://github.com/vinitshahdeo/awesome-ai-startups-hiring)
and applies through TronBrowser's `tron automate` MCP server. Meant to be run weekly.

State lives outside this public repo, in `~/.local/share/hermes-remote-jobs/ai-startups/`
(override with `AI_JOBS_STATE`):

| File | What |
|---|---|
| `applied.jsonl` | Every role already handled: submitted, unverified, manual, skipped. Discovery never shows these again. |
| `shortlist.json` | Latest discovery output, ranked. |
| `queue.json` | The roles you approved for this run. |
| `results.jsonl` / `logs/<key>.log` | Per-run outcomes and the fill log for each job. |
| `codes/<key>.txt` | Where a Greenhouse security code goes while a run waits. |

## Weekly run

1. **Discover.** `node jobs/ai-startups/discover.mjs --min-score 7`
   Prints a ranked list with flags (`ONSITE`, `CLEARANCE`, `NON-JS`, `LOCATION-BOUND`).
2. **Pick.** Write `queue.json` from the shortlist: keep real engineering roles that are
   remote in the US, and add a `key` and a `focus` per job (it completes "<company>'s work
   on ___ is exactly the production agent work I want to do"). Put anything you rule out
   in `applied.jsonl` with `"status":"skipped:<reason>"` so it stops coming back.
3. **Dry run.** `node jobs/ai-startups/apply-queue.mjs --dry-run` fills every form and
   reports `prepared` or the questions it could not answer, without submitting.
4. **Apply.** `node jobs/ai-startups/apply-queue.mjs`. When a line says
   `"status":"awaiting-code"`, find the newest "Security code for your application to
   <company>" email to anthony@profullstack.com and write the code to the `codeFile` it
   names (the run waits 5 minutes).

`apply-one.mjs <url> [--submit]` does a single form.

## What it will and won't do

- Uses `anthony.ettinger.resume5.pdf` and `anthony.ettinger.cover5.pdf` (override with
  `RESUME_PDF` / `COVER_PDF`), and the answers in `RULES` in `apply-one.mjs`: US
  citizen, no sponsorship, Bay Area, Los Gatos.
- Stops without submitting if any required field has no rule, if the resume isn't shown as
  attached, or if a consent/arbitration box is required. Those are yours to do by hand.
- `unverified` means submit was clicked and no error appeared, but no thank-you text was
  seen. It is recorded as applied so it is never sent twice.
- Ashby employers often send no confirmation email, so a missing email proves nothing.

## Tron requirements

- `apply-one.mjs` needs a `tron` with `browser_upload` and custom-combobox `browser_select`
  (tronbrowser.dev PR #113). Until that ships in a release, point at a build:
  `TRON_AUTOMATE_BIN=<tronbrowser.dev>/packages/sdk/dist/automate-bin.js`.
- On a box missing GTK accessibility libs, the bundled engine won't start. The workaround
  used here is `apt-get download` + `dpkg -x` of libatk1.0-0t64, libatk-bridge2.0-0t64,
  libatspi2.0-0t64, libxcomposite1, libxdamage1 and libxres1 into
  `~/.local/lib/tronbrowser/userlibs/root`. Then use a wrapper at
  `~/.local/lib/tronbrowser/userlibs/ungoogled-chromium-nosandbox` that sets
  `LD_LIBRARY_PATH` and execs the engine with `--no-sandbox` (`TRON_CHROMIUM_BIN`).
