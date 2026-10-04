# Local AI in Review

[FluentTyper](../README.md) / Local AI

**Availability:** Chrome and Edge builds include Local AI. Firefox builds do not include it.
Local AI is optional. It stays off until you install a model in Settings.
You do not need it for word suggestions, spelling checks, or standard Review.

## What it adds

Local AI can check English text with nearby sentence context. It can also propose a rewrite when you ask for one.
It runs on your device and never supplies autocomplete while you type.

| Mode        | What you control                                                                   |
| ----------- | ---------------------------------------------------------------------------------- |
| **Correct** | Inspect proposed corrections before applying them.                                 |
| **Rewrite** | Choose a style, generate a proposal, and inspect the changes before applying them. |

AI can miss mistakes or suggest an incorrect change. Read each proposal before you accept it.
AI suggestions do not enter **Fix all safe**.

## Before you start

Local AI needs a compatible device.
Local AI checks English only.

The first setup downloads model files. The current options require several gigabytes of disk space and compatible graphics hardware.
Settings shows the download size and any unsupported-device message before installation.
Loading the model can take several seconds. Standard Review remains available without it.

## Setup and removal

To install Local AI in Chrome or Edge:

1. Open **Settings → Grammar → Local AI**.
2. Choose a model.
3. Select **Download and enable**.
4. Read the download notice.
5. Confirm only if you want the download.

After installation, the model can work offline. Turning Local AI off keeps the downloaded files but stops its use.
**Delete model** deletes those files. FluentTyper does not download them again until you request it.

## Your text stays on your device

The model provider receives ordinary connection data during download, such as your IP address and the files requested.
It does not receive your draft, prompts, or results.

FluentTyper keeps reviewed text and results in memory for the open review. It does not upload, log, or save them.
Closing the last Review releases the model. This is not a guarantee that the operating system securely erases all memory.

## Known limits

The [engineering reference](local-ai-reference.md#known-limitations) lists the known limits of runtime stability, speed, and hardware coverage.
The [evaluation report](local-ai-evaluation.md) records measured quality and speed, with its limits.

---

[Use standard Review](review-mode.md) · [Privacy and security](../SECURITY.md) · [Local AI engineering reference](local-ai-reference.md)
