# Conditional execution with Decide

Open [noodle-graph.json](noodle-graph.json) with the editor's **Load** command. The
first Decide routes a request to a technical answer or to another Decide. The
second Decide chooses a playful or direct answer. A shared context step feeds
the answer writers, and Join emits the one selected answer.

On a Decide card, select **yes / no** and check **Run only the Yes or No branch**.
Its **yes** and **no** outputs control the first node in each branch. The
selected output carries the text the Decider judged, or the answer if there was
no text. The regular **text** port still carries the answer. An ordinary wire
from a shared prerequisite supplies data and cannot open a branch. A Join with
an active routed input receives only active inputs. Invalid answers stop both
branches.

Existing graphs preserve their original Decide settings. New branch graphs
require a compatible executor. Regenerate standalone HTML from the updated
editor when adding branching to an exported app.

The same JSON is used in the offline SDK and MCP tests. To run the browser
test locally, use the Playwright installation from the browser smoke suite.

```sh
NANOODLE_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/smoke-decider-branches.mjs
```
