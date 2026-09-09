# Voice and calls in Clawd Bot

Clawd Bot can read replies aloud and support spoken conversations in the macOS desktop app. Speech synthesis runs in the harness; the renderer requests and plays audio without receiving provider credentials.

## Choose a voice

| Provider | Requirements | Output |
| --- | --- | --- |
| Built-in Mac voices (`system`) | macOS and an installed voice; no API key | WAV audio generated with `/usr/bin/say` |
| ElevenLabs (`elevenlabs`) | An ElevenLabs key and selected voice | Hosted synthesis audio |

Select a provider and voice in the app's voice settings or agent profile. A bot's own voice can satisfy readiness even without an app-wide default. `configured` means the provider is available; `ready` also requires a voice choice. Missing setup returns an explanatory HTTP 409 from synthesis, rather than a generic provider error.

## Start a call

Calls require the macOS desktop speech helper, microphone access, and speech-recognition permission. The call button explains missing capabilities or voice setup. Bot calls can use the workspace default voice; channel calls require an explicit voice for every participating member.

Calls are half-duplex: microphone capture pauses while the bot speaks. Use the call controls to interrupt or hang up. There is no acoustic echo-cancellation path for hands-free voice barge-in.

Call mode uses an 850 ms transcript-stability interval before ending capture and requesting a final transcript. This is an endpointing setting, not an end-to-end latency guarantee. Composer dictation keeps its explicit stop behavior.

Tool narration uses the harness's `tool.spoken` text. Pending approvals and questions can be read aloud and answered through the call flow. Inspect the approval card whenever spoken intent is ambiguous; voice recognition is not an independent authorization system.

## Data flow

```text
Microphone → native speech helper → transcript → harness/selected agent
Agent reply → speech-text preparation → selected voice provider → audio playback
```

The native helper uses Apple's Speech framework. It requests on-device recognition when the selected recognizer supports it; the implementation does not enforce that setting when unsupported. Do not describe every speech-recognition request as guaranteed local-only. ElevenLabs receives the text submitted for hosted synthesis. System voices synthesize through the Mac's installed speech engine.

The harness converts Markdown into speakable utterances instead of reading code blocks and markup literally. The renderer queues clips and prefetches subsequent utterances. Routes are:

- `GET /api/tts/voices`: list the selected provider's voices.
- `POST /api/tts/prepare`: prepare utterances and report voice readiness.
- `POST /api/tts/speak`: synthesize a bounded utterance using an optional voice override.

Leaving the call target, hanging up, or interrupting must stop playback and release capture. Intentional microphone stops must not trigger a new listening cycle during playback.

## Limits and validation

Calls depend on macOS dictation capabilities; system voices are also macOS-only. Hosted read-aloud is separate from call availability. There is no voice spend meter, and provider charges are not estimated by this document.

Source: [provider selection](../server/tts/index.ts), [system synthesis](../server/tts/system-voices.ts), [call view](../src/components/CallView.tsx), and [native recognizer](../electron/resources/speech-helper.swift).

Run `npx vitest run server/tts src/lib/call.test.ts src/lib/group-call.test.ts` for focused coverage. On a Mac, also verify voice setup, spoken replies, a channel with per-member voices, an approval, cancellation, navigation away, and microphone release. Unit tests do not prove audio quality or native permission behavior.
