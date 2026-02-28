import {
  ConfigError,
  PredictorError,
  TransportError,
} from "../src/core/domain/error";
import { mapRuntimeError } from "../src/adapters/chrome/background/router/RuntimeErrorMapper";

describe("RuntimeErrorMapper", () => {
  test("maps typed config errors", () => {
    const mapped = mapRuntimeError(
      new ConfigError("Config lookup failed", {
        code: "config_lookup_failed",
      }),
    );

    expect(mapped).toEqual({
      category: "config",
      code: "config_lookup_failed",
      message: "Config lookup failed",
      response: { ok: false },
    });
  });

  test("maps typed transport errors", () => {
    const mapped = mapRuntimeError(
      new TransportError("Tab messaging failed", {
        code: "transport_send_failed",
      }),
    );

    expect(mapped).toEqual({
      category: "transport",
      code: "transport_send_failed",
      message: "Tab messaging failed",
      response: { ok: false },
    });
  });

  test("maps typed predictor errors", () => {
    const mapped = mapRuntimeError(
      new PredictorError("Prediction failed", {
        code: "predictor_run_failed",
      }),
    );

    expect(mapped).toEqual({
      category: "predictor",
      code: "predictor_run_failed",
      message: "Prediction failed",
      response: { ok: false },
    });
  });

  test("maps unknown errors to generic runtime failure", () => {
    const mapped = mapRuntimeError(new Error("boom"));

    expect(mapped).toEqual({
      category: "unknown",
      code: "unhandled_runtime_error",
      message: "boom",
      response: { ok: false },
    });
  });
});
