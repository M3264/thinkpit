# Initial conversation evaluation

September 30, 2026. This is an exploratory pilot using a free anonymous endpoint, not proof that multi-model discussion improves decisions.

Eight fictional decisions were run in single-participant and two-participant modes using Pollinations `openai-fast`. Both participants use the same underlying model. The single participant received one turn; the pair received at most one turn each. Questions were disabled. Each requested at most 1,024 output tokens. The pair inherited the library example's access/staffing instructions across all scenarios, a confound for topics beyond the library.

| Scenario | Single | Conversation |
| --- | --- | --- |
| library | Failed: provider exceeded token reservation | 2 completed, 44.0s |
| launch | 1 completed, 27.9s | 2 completed, 59.6s |
| architecture | Failed: missing conversation control record | 2 completed, 61.0s |
| pricing | 1 completed, 33.4s | 2 completed, 59.8s |
| community | 1 completed, 27.2s | Failed: provider did not finish contribution |
| learning | 1 completed, 36.7s | 2 completed, 54.7s |
| migration | Failed: missing conversation control record | Failed: missing conversation control record |
| design | Failed: provider did not finish contribution | 2 completed, 62.1s |

10 of 16 runs completed without a provider/protocol failure: 4 of 8 single-participant runs and 6 of 8 paired runs. Only launch, pricing, and learning produced two successful sides for a direct comparison. Failure counts do not establish a usefulness advantage.

Observed findings:

- The successful learning exchange responded to the first participant's specific proposal and challenged the time needed for reflection. Pricing also challenged assumptions about stable usage and linear costs.
- Launch replies agreed about an MVP but changed a proposed engagement threshold from 30% to 50% without justification. This is responsive variation, not independently supported disagreement.
- Several replies invented evidence: learning cited unspecified studies; architecture asserted unsupported queue throughput; design supplied conversion percentages despite instructions not to invent data. The second participant sometimes repeated those unsupported claims.
- One reply in the earlier smoke test addressed a display name rather than its participant ID. Explicit permitted ID values were added to the prompt before this pilot.
- The pilot then showed missing control records, unfinished contributions, and a reported output-token count above the requested cap. The engine surfaced each failure and did not schedule a substitute model.
- Multi-participant runs increased latency and usually usage. Failed calls with missing final usage retained the conservative reservation; charged token units are not an exact cross-provider cost measurement.

Implementation response: deterministic invariants remain engine-owned; malformed model controls fail visibly. The evaluation harness is being made neutral to remove library-specific participant instructions from future runs. Further evaluations need model diversity and a control protocol that smaller/free models follow consistently. The next prompt iteration should explicitly reject invented evidence and label proposed thresholds as suggestions.

The deterministic engine and PostgreSQL integration gates pass. Conversational usefulness remains unproven; the web interface and supported account connections remain future work.

The [raw metrics](evaluation/2026-09-30/results.json) and fictional Markdown transcripts in that directory are committed for review. These were generated before the final bookkeeping and CLI fixes; those fixes did not change conversational prompts.
