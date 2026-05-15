import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';

const OTEL_ENDPOINT = import.meta.env.VITE_OTEL_ENDPOINT ?? 'http://localhost:4318';

export function initTelemetry() {
  const exporter = new OTLPTraceExporter({ url: `${OTEL_ENDPOINT}/v1/traces` });
  const provider = new WebTracerProvider({
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();
  registerInstrumentations({
    instrumentations: [new FetchInstrumentation()],
  });
}
