# Calibration

Model answers vs `answer-key.json`. 1 of 18 outside tolerance.

|     | file                      | question                        | expected                           | actual                             |
| --- | ------------------------- | ------------------------------- | ---------------------------------- | ---------------------------------- |
| ✓   | bad-flush-success-only.ts | flush_before_exit               | noul=0.08                          | noul=0.06                          |
| ✓   | benign-attributes.ts      | sensitive_0_attr_0              | noul=0.05                          | noul=0.04                          |
| ✓   | benign-attributes.ts      | sensitive_0_attr_1              | noul=0.04                          | noul=0.03                          |
| ✓   | benign-attributes.ts      | sensitive_0_attr_2              | noul=0.02                          | noul=0.02                          |
| ✓   | esm-import-order.ts       | esm_manual_instrumentation      | relies_on_import_order (conf 0.83) | relies_on_import_order (conf 1.00) |
| ✓   | good-flush.ts             | flush_before_exit               | noul=0.94                          | noul=0.82                          |
| ✓   | good-flush.ts             | relevant__setup-typescript      | noul=0.95                          | noul=0.88                          |
| ✓   | hint-error-status.ts      | relevant__fundamentals-overview | noul=0.72                          | noul=0.56                          |
| ✗   | hint-error-status.ts      | relevant__production-typescript | noul=0.91                          | noul=0.43                          |
| ✓   | pii-attributes.ts         | sensitive_0_attr_0              | noul=0.03                          | noul=0.04                          |
| ✓   | pii-attributes.ts         | sensitive_0_attr_1              | noul=0.96                          | noul=0.98                          |
| ✓   | pii-attributes.ts         | sensitive_0_attr_2              | noul=0.97                          | noul=0.98                          |
| ✓   | pii-attributes.ts         | sensitive_0_bulk                | noul=0.90                          | noul=0.94                          |
| ✓   | pii-masked.ts             | sensitive_0_bulk                | noul=0.90                          | noul=0.87                          |
| ✓   | session-wrapper.ts        | no_session_wrapper              | noul=0.97                          | noul=0.98                          |
| ✓   | simple-processor.ts       | flush_before_exit               | noul=0.90                          | noul=0.79                          |
| ✓   | span-kind-mismatch.ts     | span_kind_0                     | RETRIEVER (conf 0.88)              | RETRIEVER (conf 1.00)              |
| ✓   | span-kind-mismatch.ts     | span_kind_1                     | CHAIN (conf 0.80)                  | CHAIN (conf 0.85)                  |

22 requests, 136,551 input tokens ≈ $0.0057
