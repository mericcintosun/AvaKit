---
"create-avalanche-app": patch
---

Make the `create-avalanche-app` CLI feel like a product. The prompts are now one
cohesive `group` with a single cancel handler (and any answer passed as a flag
skips its prompt); scaffolding and install run as a ticked-off task list;
wallet/network labels are cleaner; and the run ends with a linked summary. The
off-brand cyan intro pill is replaced by a branded header under the ASCII banner.
