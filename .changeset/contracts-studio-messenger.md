---
"@avakit/studio": patch
---

Studio now deploys the hardened ICM messenger: it rejects a zero origin sender
from an unregistered chain, and refuses a message longer than 256 bytes when it
is sent instead of letting it run out of gas on delivery and never arrive.
