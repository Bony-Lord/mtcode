import {
  BENCHMARK_SOURCES,
  DEFAULT_MODEL_BENCHMARKS,
  parseBenchmarkPages,
} from "@t3tools/shared/modelBenchmarks";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { FetchHttpClient } from "effect/http";
import { ServerSettingsService } from "../serverSettings.ts";
import * as Schema from "effect/Schema";

class ModelBenchmarkParseError extends Schema.TaggedError<ModelBenchmarkParseError>()(
  "ModelBenchmarkParseError",
  { cause: Schema.Defect() },
) {}

const attempts = new WeakMap<object, number>();
export const refreshModelBenchmarks = Effect.fn("ModelBenchmarks.refresh")(function* (
  force = false,
) {
  const service = yield* ServerSettingsService;
  const settings = yield* service.getSettings;
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const previous = settings.modelBenchmarkSnapshot ?? DEFAULT_MODEL_BENCHMARKS;
  if (
    !force &&
    (now - Date.parse(previous.checkedAt) < 86_400_000 ||
      now - (attempts.get(service) ?? 0) < 900_000)
  )
    return;
  attempts.set(service, now);
  const client = yield* HttpClient.HttpClient;
  const get = (url: string) =>
    client.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((r) => r.text),
      Effect.timeout("12 seconds"),
    );
  const [terminal, intelligence] = yield* Effect.all(
    [get(BENCHMARK_SOURCES.coding), get(BENCHMARK_SOURCES.intelligence)],
    { concurrency: 2 },
  );
  const snapshot = yield* Effect.try({
    try: () =>
      parseBenchmarkPages(terminal, intelligence, DateTime.formatIso(DateTime.makeUnsafe(now))),
    catch: (cause) => new ModelBenchmarkParseError({ cause }),
  });
  yield* service.updateSettings({ modelBenchmarkSnapshot: snapshot });
});

export const ensureModelBenchmarks = () =>
  refreshModelBenchmarks().pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.catchCause((cause) =>
      Effect.logWarning("Model benchmarks kept their last verified snapshot", {
        cause: String(cause),
      }),
    ),
  );
