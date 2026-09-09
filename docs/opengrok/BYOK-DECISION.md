# Choosing a model route in Clawd Bot

Start with the engine supported by the Clawd Bot application you are running.
The standalone app and parent reconstructed desktop have different settings
surfaces; an upstream `ModelAllowlistByok` reference is not a universal UI contract.

| Route | When to use it | What to verify |
| --- | --- | --- |
| Native engine | A supported CLI session or compatible provider driver fits the task | Authentication, exact model selection, streaming, and required tools |
| Hosted gateway | Operator credentials should stay on the server | Account token, provider/model grants, quotas, and explicit rejection on failure |
| Optional hop | A reviewed adapter must translate protocol or provider controls | Adapter availability, compatible host consumer, and a normal routed turn |

A hop does not grant subscription access or make arbitrary authentication flows
compatible. Use credentials and protocols supported by the selected provider.
Keep secrets out of model bindings and distribute only scoped account access
for hosted services.

Reasoning effort, token budgets, and tool support vary by route. Verify their
request mapping instead of assuming that the same picker label produces the
same request across engines. Unknown controls should remain unapplied or fail
explicitly according to the driver's contract.

See [model guidelines](MODEL-GUIDELINES.md), [box integration](BOX-INTEGRATION.md),
and [Clawd Bot hosted access](../FLY-HOSTING.md).
