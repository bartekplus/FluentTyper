# Give numbers room to read

[FluentTyper](../README.md) / Measurement spacing

FluentTyper can add a missing space between a number and a supported measurement unit as you write.
Your number, precision, and unit stay the same.

| You type            | FluentTyper can format |
| ------------------- | ---------------------- |
| `Mass: 1.50kg`      | `Mass: 1.50 kg`        |
| `Temperature: 20°C` | `Temperature: 20 °C`   |
| `Speed: 5m/s`       | `Speed: 5 m/s`         |

These examples use English text. Formatting occurs after a completed expression when you type a space or start a new line.
The inserted space keeps the number and unit together on one line.

## Turn the check on or off

1. Open FluentTyper's **Settings** from the extension popup.
2. Select **Grammar**.
3. Find **Measurement unit formatting**.
4. Change its Typing or Review control for the behavior you want.

Typing and Review use separate controls. Review proposes eligible spacing corrections when you [check a draft](review-mode.md).

## What stays unchanged

FluentTyper does not convert units or change the value. `1.50kg` stays `1.50 kg`, with both decimal places.
Existing spaces remain unchanged.

Code, web addresses, email addresses, and other protected text remain outside the check.
The check leaves an expression unchanged when its meaning or editing context is uncertain.

## Language and coverage

Decimal punctuation follows the writing language. For example, French prose can use `1,50kg` → `1,50 kg`.
Choose the correct [writing language](review-language-matrix.md) for your text.

The check supports many common scientific and everyday symbols. It does not support every unit, abbreviation, or fully written unit name.
Ambiguous regional units and specialized notation can remain unchanged.

Currency spacing is a separate check. It also preserves the number and does not convert money.

## If spacing does not change

Check that the rule is enabled and the field supports prose editing. Finish the expression with a space or a new line.
If the expression remains unchanged, it may be outside the supported set or ambiguous in that context.

For exact coverage, data sources, and verification limits, see the [technical reference](measurement-formatting-reference.md).

---

[Review text](review-mode.md) · [Writing languages](review-language-matrix.md) · [Return to FluentTyper](../README.md)
