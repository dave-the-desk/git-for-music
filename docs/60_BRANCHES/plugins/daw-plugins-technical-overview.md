# DAW Audio Plugins: A Technical Overview

Branch-scoped reference for the `plugins` branch. This document explains what audio
plugins are, how they work at a technical level, and surveys the major plugin
standards and research systems referenced in `docs/papers/daw-plugins/` and the
linked online specifications.

## Sources

- **Papers** (in `docs/papers/daw-plugins/`)
  - `2503.02977v1.pdf` — Benetatos et al., *HARP 2.0: Expanding Hosted, Asynchronous, Remote Processing for Deep Learning in the DAW* (ISMIR 2024 LBD).
  - `3487553.3524225.pdf` — Buffa et al., *Web Audio Modules 2.0: An Open Web Audio Plugin Standard* (WWW '22 Companion). DOI `10.1145/3487553.3524225`.
  - `43.dafx2013_submission_52.pdf` — Norilo, *Kronos VST — The Programmable Effect Plugin* (DAFx-13).
- **Online specifications**
  - LV2 — https://lv2plug.in/
  - VST 3 Module Architecture — https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/VST%2BModule%2BArchitecture/Index.html
  - VST 3 API Documentation — https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/API%2BDocumentation/Index.html
  - VST 3 Loading — https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/VST%2BModule%2BArchitecture/Loading.html
  - JUCE `AudioProcessor` — https://docs.juce.com/master/classjuce_1_1AudioProcessor.html
  - Buffa et al. 2018, *Towards an open Web Audio plugin standard* — DOI `10.1145/3184558.3188737` (the WAP precursor to WAM 2.0).

---

## 1. What a Plugin Is

A **plugin** is a modular software audio device (an effect, instrument, or
control/MIDI processor) that is deployed as a separate binary and loaded at
runtime by a **host** application, typically a Digital Audio Workstation (DAW).
The plugin concept was popularized by **Steinberg VST** in 1996, which defined a
standard where modular audio devices are shipped as dynamic libraries that a host
loads on demand (Buffa et al. 2022; Norilo 2013).

Plugins exist because they decouple *signal-processing innovation* from *host
development*. Compared to building a complete audio application, a plugin requires
far fewer resources, letting small teams and academic researchers ship
specialized processors and demonstrate novel DSP concepts "in context" inside a
familiar production environment (Norilo 2013).

### Plugin categories

- **Audio effects** — transform an incoming audio stream (EQ, reverb, compressor,
  distortion).
- **Instruments / synthesizers** — generate audio, usually driven by MIDI note
  events.
- **MIDI / control processors** — transform note, controller, or automation data
  rather than (or in addition to) audio.
- **Analysis / metering** — read audio and produce measurements, labels, or
  visualizations rather than modifying the signal.

---

## 2. The Host–Plugin Contract (How Plugins Work)

Every mainstream plugin standard — VST, Apple Audio Unit (AU), Avid AAX, and the
open-source LADSPA/LV2 — shares the same core responsibilities (Buffa et al. 2022):

1. **Processing blocks of audio samples** in a real-time callback.
2. **Handling parameter changes** (from the GUI or host automation).
3. **Handling MIDI** and other control events.
4. **Managing state** (saving/restoring the full plugin configuration with a project).

The differences between standards are largely in *packaging, discovery, the ABI,
and the object model* — not in these fundamental duties. This is why intermediate
C++ frameworks such as **JUCE** and **iPlug** exist: they let a developer write a
single codebase and compile it to multiple target APIs at once (Buffa et al. 2022).

### 2.1 The real-time audio thread

Audio processing is a **hard real-time** task: every block of samples must be
computed within a fixed deadline (typically a few milliseconds) tied to the
buffer size and sample rate. Missing the deadline produces audible glitches
(Buffa et al. 2022).

Consequences that shape every plugin API:

- The `process` callback runs on a **high-priority audio thread**, separate from
  the UI/main thread.
- Inside the callback you must **not** allocate memory, lock unbounded mutexes,
  do file/network I/O, or touch the GUI. JUCE's `processBlock` documentation is
  explicit: "any kind of interaction with the UI is absolutely out of the
  question" — communicate with the UI via asynchronous messages instead
  (`ChangeBroadcaster`/`AsyncUpdater`).
- Block sizes are **not guaranteed constant**. Hosts may send blocks larger or
  smaller than the "maximum expected" value given at preparation time, and may
  even send zero-sample blocks. Code must cope with variable-sized blocks
  (JUCE `processBlock`, `prepareToPlay`).

### 2.2 Lifecycle

Illustrated with JUCE's `AudioProcessor`, whose lifecycle mirrors the underlying
native formats:

- **Construction / instantiation** — the host creates an instance (see per-format
  loading below). A processor declares its input/output **buses** at construction.
- **`prepareToPlay(sampleRate, maxBlockSize)`** — called before playback starts.
  The sample rate stays constant until playback stops; this is where you size
  internal buffers and precompute coefficients.
- **`processBlock(buffer, midiMessages)`** — the real-time render call. The buffer
  holds at least `max(numInputs, numOutputs)` channels; input channels arrive
  filled and must be overwritten with output. MIDI messages carry sample-accurate
  timestamps relative to the block start; leftover messages in the buffer are
  treated as the plugin's MIDI output.
- **`releaseResources()`** — free everything allocated for playback.
- **Destruction** — release all resources; every standard has an explicit
  teardown path so the host can reclaim resources deterministically.

### 2.3 Parameters and automation

Parameters are the host-visible, automatable controls of a plugin. Hosts need to:
enumerate parameters and their metadata (name, range, units), read/write values,
and **schedule automation** — ideally **sample-accurate** so that a value change
lands on the exact sample it was drawn on. In JUCE, parameters live in a
`AudioProcessorParameter` tree; native formats expose equivalent enumeration and
automation interfaces.

### 2.4 Buses and channel layouts

Modern formats support multiple input/output **buses**, each with a semantic label
and an arbitrary channel count (Norilo 2013; JUCE `BusesLayout`). Typical uses:

- **Multiple input buses** — e.g. a **sidechain** input for a compressor.
- **Multiple output buses** — e.g. a multi-out instrument feeding several mixer
  channels.

The host and plugin negotiate a supported layout (`isBusesLayoutSupported` /
`checkBusesLayoutSupported` in JUCE).

### 2.5 State management

A plugin can have hundreds of parameters and internal state. When a user saves a
project, the host must be able to **recall and reapply** the complete state later
(Buffa et al. 2022). JUCE exposes `getStateInformation`/`setStateInformation`
(opaque binary blobs, often XML serialized to binary). This is the "save/restore"
contract every standard requires.

---

## 3. How a DAW Plug-in Host Works Internally

Everything in Section 2 describes the contract from the *plugin's* side. This
section describes the same contract from the *host's* side: the **plug-in hosting
layer** that sits between the DAW's audio engine and third-party plug-in binaries.

### 3.1 The hosting layer and adapter architecture

At a high level the hierarchy looks like this:

```
DAW Project
  └── Tracks
        └── Insert Chain / Instrument Slot
              └── PluginHostAdapter
                    ├── VST3HostAdapter
                    ├── AUHostAdapter
                    ├── CLAPHostAdapter
                    ├── LV2HostAdapter
                    └── AAXHostAdapter
                          ↓
                    Loaded Plugin Instance
                          ↓
                    process(audioBuffer, midiEvents, automation)
```

The critical design point is **isolation through adapters**: the rest of the DAW
must never talk directly to VST 3, AU, CLAP, LV2, or AAX. Each format gets an
adapter that **normalizes** a plug-in into the DAW's *own* internal interface, so
the audio engine, mixer, and automation system only ever see one abstraction.

This mirrors the abstractions each standard already uses internally (Section 2):
VST-MA hides implementations behind `FUnknown`, and JUCE's `AudioProcessor` is a
single base class "general enough to be wrapped as a VST, AU, AAX, etc." and is
*also* reused as the wrapper around a loaded plugin when JUCE acts as a host (JUCE
docs). The DAW's `PluginHostAdapter` plays exactly the role JUCE's wrapper plays.

### 3.2 The normalized internal interface

A typical internal interface (shown in TypeScript for readability — in a real C++
DAW this would be a native C++ abstract class, but the shape is identical):

```ts
interface HostedPlugin {
  id: string;
  name: string;
  format: 'vst3' | 'au' | 'clap' | 'lv2' | 'aax';

  prepare(sampleRate: number, maxBlockSize: number): void;
  process(audioIn: AudioBlock, midiIn: MidiEvent[], automation: AutomationEvent[]): AudioBlock;

  getParameters(): PluginParameter[];
  setParameter(id: string, normalizedValue: number): void;

  getState(): Uint8Array;
  setState(state: Uint8Array): void;

  createEditorView?(): NativePluginEditorHandle;
}
```

Each method maps onto a concrete native call inside the format adapter:

- **`prepare`** → JUCE `prepareToPlay(sampleRate, maxBlockSize)`; VST 3
  `IAudioProcessor::setupProcessing` + `IComponent::setActive(true)`.
- **`process`** → JUCE `processBlock`; VST 3 `IAudioProcessor::process(ProcessData&)`.
- **`getParameters` / `setParameter`** → VST 3 `IEditController` parameter
  enumeration and `setParamNormalized`; JUCE's `AudioProcessorParameter` tree.
  Values are passed **normalized** (0..1) so the host is agnostic to each
  parameter's real-world units.
- **`getState` / `setState`** → VST 3 `IComponent::getState`/`setState`; JUCE
  `getStateInformation`/`setStateInformation`. State is an opaque byte blob the
  host stores but never interprets.
- **`createEditorView`** → optional, because UI and DSP are separate concerns
  (Section 3.3, point 4).

### 3.3 The hard technical parts

**1. Real-time audio-thread safety.** The plug-in's audio callback cannot block.
No disk I/O, network calls, memory allocation, locks, console logging, or
long-running UI work inside the audio thread. VST 3 explicitly warns that
`IAudioProcessor::process` may run on the real-time audio thread and should avoid
memory allocation; JUCE's `processBlock` docs likewise forbid any UI interaction
and require asynchronous messaging (`ChangeBroadcaster`/`AsyncUpdater`) instead
(see Section 2.1). Because locks, system calls, allocation, and even some
innocuous-looking library calls can each cause priority inversion or unbounded
latency, they glitch audio when used on the audio thread. The adapter must
therefore pre-allocate all per-block scratch buffers in `prepare`, never in
`process`.

**2. Audio is processed in blocks.** DAWs do not send one sample at a time. Each
call carries a **block** of samples plus MIDI events, time/transport context, and
parameter changes. In VST 3 the host calls `process` passing a `ProcessData`
struct that bundles the audio input/output buses, sample-accurate parameter change
queues, and event lists. Block sizes can vary per call (and may even be zero), so
both the adapter and the plug-in must cope with variable-sized blocks (Section
2.1–2.2).

**3. Parameters and automation are host-owned.** A plug-in *exposes* parameters,
but the DAW *owns* the automation: it records automation curves and streams
parameter changes during playback. In VST 3 those changes are delivered **inside**
the `process` call via `IParameterChanges` (sample-accurate), and GUI edits are
transmitted through the same automation path so the processor sees UI moves and
recorded automation identically (Section 2.3).

**4. UI and DSP are separate concerns.** Modern formats separate the audio
processor from the editor/controller. VST 3 strongly encourages splitting
`IComponent` (the real-time processor) from `IEditController` (parameters + GUI),
so the processor runs in the real-time context while the GUI updates at a lower,
non-real-time frequency — and the two can even live in different processes. This
is why `createEditorView` is optional in the interface above: a headless host
never needs it.

**5. State must be serializable.** The DAW saves each plug-in's state inside the
project file: presets, parameter values, internal DSP state, routing, and
sometimes sample/file references. VST 3's `IComponent` provides `getState`/
`setState` for preset and project persistence; JUCE mirrors this with
`getStateInformation`/`setStateInformation` (Section 2.5). The host treats the
blob as opaque, which is what lets it round-trip any plug-in it has never seen.

**6. Plug-in compatibility is messy.** Even a spec-conforming plug-in behaves
differently across hosts, because host implementations vary. Apple's Audio Unit
guidance explicitly notes that spec-conforming audio units still must be tested in
commercial hosts. This is the practical reason the adapter layer exists: it is
also the place to absorb per-format and per-plug-in quirks so they never leak into
the DAW's engine.

### 3.4 A note on CLAP

The adapter list includes **CLAP** (CLever Audio Plug-in API), a newer open,
permissively licensed standard. Conceptually it fits the same contract described
here — block-based `process`, host-owned parameter/automation with sample-accurate
events, serializable state, and separable UI — while adding first-class,
thread-safe parameter and note-expression event queues. From the host's
perspective it is simply another `HostedPlugin` behind a `CLAPHostAdapter`.

---

## 4. Native Plugin Standards

### 4.1 VST 3 and the VST Module Architecture (VST-MA)

VST 3 is built on top of **VST Module Architecture (VST-MA)**, a component-model
system used across all Steinberg hosts. Key properties (Steinberg VST-MA docs):

- **COM-like, object-oriented, cross-platform, (almost) compiler-independent.**
  It closely resembles Microsoft COM. It is provided in **C++ only**, where
  interfaces are pure virtual classes (only abstract methods).
- **`FUnknown`** is the root interface; all others derive from it (directly or
  indirectly), providing reference counting and `queryInterface`.
- **IID vs. CID** — every *interface* has a unique identifier (**IID**, a
  `FUID`). Every concrete *implementation class* has a **class/component id
  (CID)** passed to the factory to create it. Many different classes can implement
  the same interface.
- **Interface direction** — an interface is tagged `[host imp]` (host implements)
  or `[plug imp]` (plugin implements); untagged interfaces work both ways.
- **Versioning by inheritance** — once released, an interface *never changes*.
  New functionality means a new interface (e.g. `IPluginFactory3` extends
  `IPluginFactory2`). Inheritance is used *only* for versioning, not for modeling
  object specialization.

#### Module packaging and the plugin factory

- A **module** is a DLL (Windows), Mach-O bundle (macOS), or package (Linux)
  containing one or more components.
- The module exports a C-style function **`GetPluginFactory()`** returning an
  `IPluginFactory`. This factory is the anchor point: it enumerates classes,
  exposes their metadata, and creates instances.
- Every class the factory can create belongs to a **category** that tells the host
  its purpose (e.g. `"Audio Module Class"` for VST 3 audio plugins). The special
  `"Service"` category is loaded automatically at startup.
- The entry point for any component class is **`IPluginBase`**, which the host uses
  to `initialize` (passing a *host context* of interfaces the plugin needs) and
  `terminate` the component.

#### How the host loads a VST-MA plugin (from the Loading docs)

- **Discovery by location, not registration** (unlike DirectX): the host scans
  predefined folders and subfolders at startup (application `Components`, and the
  shared Steinberg components folders on Windows/macOS).
- **Platform entry/exit functions:**
  - Windows: `InitDll` / `ExitDll` (optional — `DllMain` already exists).
  - macOS: `bundleEntry` / `bundleExit` (**required**).
  - Linux: `ModuleEntry` / `ModuleExit` (**required**).
- **Load sequence** (Windows example): `LoadLibrary` → call `InitDll` (if present)
  → `GetProcAddress("GetPluginFactory")` → iterate `factory->countClasses()` and
  `getClassInfo()` → `factory->createInstance(cid, iid, &obj)` → use → `release()`
  each object → `factory->release()` → `ExitDll` → `FreeLibrary`.

#### VST 3 processing model

VST 3 separates responsibilities into cooperating interfaces (VST 3 API docs):

- **`IComponent`** — the processing component: bus arrangement, state, activation.
- **`IAudioProcessor`** — the real-time `process(ProcessData&)` call. `ProcessData`
  bundles audio input/output buses, parameter changes (as sample-accurate change
  queues), and event lists (MIDI, etc.).
- **`IEditController`** — parameters and the GUI/editor, deliberately separable
  from the processor so the two can even run in different contexts.
- VST 3 supports any number of input and output buses, each labeled and holding an
  arbitrary channel count (Norilo 2013).

### 4.2 Apple Audio Unit (AU) and Avid AAX

Other native standards developed by platform/DAW vendors to control their own
user experience (Buffa et al. 2022):

- **Audio Units (AU)** — Apple's Core Audio plugin format on macOS/iOS.
- **AAX** — Avid's format for Pro Tools.

They cover the same four core duties (audio blocks, parameters, MIDI, state) with
different object models — which is precisely why cross-format frameworks are
popular.

### 4.3 LADSPA / LV2 (open source)

**LV2** is an **extensible open standard** for audio plugins and the successor to
LADSPA (lv2plug.in). Its design philosophy is a **minimal core plus extensions**:

- The core interface is deliberately simple; advanced capabilities are added via
  **extensions** rather than bloating the base API.
- Supports **audio effects, synthesizers, and control processors** for modulation
  and automation.
- Notable extension-provided features:
  - Platform-native UIs.
  - Network-transparent plugin control.
  - **Portable, archivable persistent state** (state you can save and move
    between machines).
  - **Non-realtime tasks** (like file loading) with sample-accurate export.
  - **Semantic control** — meaningful control designations and value *units*.
- Permissively licensed free software, cross-platform, currently LV2 1.18.x.

LV2's extensibility is its defining contrast with the monolithic-interface
approach of VST/AU: hosts and plugins negotiate which extensions they support,
so the standard can evolve without breaking the ABI.

### 4.4 Cross-format frameworks: JUCE

**JUCE** provides `juce::AudioProcessor` as a single base class "general enough to
be wrapped as a VST, AU, AAX, etc." (JUCE docs). A developer derives from
`AudioProcessor`, implements the global `createPluginFilter()` factory function,
and JUCE's wrappers adapt it to each target format. Its `WrapperType` enum shows
the breadth of supported targets: `VST`, `VST3`, `AudioUnit`, `AudioUnitv3`,
`AAX`, `Standalone`, `Unity`, and `LV2`. The same class is also reused by JUCE's
*hosting* code as the wrapper around a loaded plugin, so host and plugin share one
abstraction.

Key `AudioProcessor` surface area:

- Lifecycle: `prepareToPlay`, `processBlock`, `releaseResources`, `reset`.
- Buses: `BusesLayout`, `getBusBuffer`, `isBusesLayoutSupported`,
  `setBusesLayout`.
- Precision: single- and double-precision processing
  (`supportsDoublePrecisionProcessing`).
- Latency/tail: `setLatencySamples`, `getTailLengthSeconds` so the host can
  compensate delay.
- MIDI: `acceptsMidi`, `producesMidi`, `isMidiEffect`.
- State: `getStateInformation` / `setStateInformation`, plus program (preset)
  management.
- Threading: `getCallbackLock`, `suspendProcessing` for safe cross-thread edits.

---

## 5. Web Audio Modules 2.0 (WAM2): Plugins for the Browser

`3487553.3524225.pdf` — Buffa et al., WWW '22. WAM 2.0 brings the native plugin
model to the Web platform, building on the earlier **Web Audio Modules** (Kleimola
& Larkin, 2015) and the **Web Audio Plugins (WAP)** standardization effort
(Buffa et al. 2018, DOI `10.1145/3184558.3188737`).

### Motivation

The **Web Audio API 1.0** offers low-level `AudioNode` unit generators (gain,
filter, delay, reverb, etc.) connected into an audio graph, but it lacks a
higher-level *plugin* abstraction equivalent to VST. Meanwhile, maturing web
standards — **WebAssembly**, stabilized **WebComponents**, and especially the
**AudioWorklet** (2018) — made professional-grade browser audio feasible. Native
DSP written in C/C++, **FAUST**, or **Csound** can now be compiled to WebAssembly
and run in the browser (Buffa et al. 2022).

### Architecture

- **AudioWorklet as the audio thread.** AudioWorklet is the *only* entry point to
  the browser's high-priority audio thread. It splits into an
  **`AudioWorkletNode`** (main thread) and an **`AudioWorkletProcessor`** (audio
  thread). WAM extends these into a **`WamNode`** / **`WamProcessor`** pair.
- **Single-node abstraction.** A WAM may internally be a subgraph of many nodes
  (built-in + custom AudioWorklets), but it presents to the host as a single
  `WamNode`/`WamProcessor`. The SDK's `CompositeAudioNode` (extends `GainNode`)
  wraps a subgraph so it behaves like one node.
- **`WamEnv` and `WamGroup`.** Because the Web Audio API offers no official way to
  talk to processors on the audio thread, WAM installs a singleton `WamEnv` in the
  audio thread's global scope. Processors are organized into `WamGroup`s (e.g. all
  plugins created by one host or subhost such as a pedalboard). `WamEnv`/`WamGroup`
  are the *only* objects the host is expected to provide.
- **Web-aware packaging.** Plugins are ordinary web resources identified by
  **URIs**. A host discovers a plugin via a JSON **descriptor** (name, version,
  loading URL), then dynamically `import`s the plugin's `index.js` ES module to
  construct instances. Remote plugins load by URL without manual download.

### Key API constructs (Table 1 in the paper)

- **`WebAudioModule`** — main entry point / plugin instance.
- **`WamDescriptor`** — general metadata about the plugin.
- **`WamNode`** — extends `AudioNode`; inserted into the host's audio graph.
- **`WamProcessor`** — extends `AudioWorkletProcessor`; processes on the audio
  thread.
- **`WamParameterInfo` / `WamParameter`** — parameter metadata and state. WAM
  deliberately does **not** expose Web Audio `AudioParam`s directly, because
  exposing potentially hundreds of WebAssembly parameters that way is too heavy
  and the `AudioParam` automation model predates direct audio-thread access. WAM
  defines its own parameter API to allow synchronous, "just-in-time"
  host↔plugin interaction on the audio thread.
- **`WamEvent`** — automation, MIDI, and OSC events, with **sample-accurate
  scheduling** mirrored on both threads. Main-thread-only hosts still schedule
  with lookahead to cross the thread barrier; audio-thread hosts can schedule at
  the start of the target render block.
- **`WamGroup` / `WamEnv`** — audio-thread event graph and processor registry.

### SDK and ecosystem

The SDK ships reference implementations plus convenience classes — notably the
**Parameter Manager (`ParamMgr`)**, which wraps `AudioParam`s as `WamParameter`s
and maps a single "exposed" parameter onto one or more "internal" parameters with
per-target scaling. Real deployments include the **FAUST online IDE** (compile
FAUST → WebAssembly WAM in minutes), **JSPatcher** (Max/PureData-style visual
patcher), **sequencer.party** (realtime collaborative platform built entirely from
WAMs), and the commercial DAW **Amped Studio**.

WAM matters to this project because it is the closest analog to a
**collaborative, web-native plugin model** — its group/event architecture and
URI-based discovery map naturally onto a web DAW with realtime collaboration.

---

## 6. Programmable Plugins: Kronos VST

`43.dafx2013_submission_52.pdf` — Norilo, DAFx-13. A **programmable plugin** is a
"meta-plugin": it implements the host-integration infrastructure but leaves the
actual DSP algorithm to the *end user*, written in a high-level language and
compiled **on the fly** while the plugin runs.

### The problem it solves

The canonical way to write a plugin is C/C++, but that requires both DSP domain
expertise *and* systems-programming skill — a rare combination. Worse, the
edit-compile-debug loop is especially painful for plugins: compilation can take
minutes, and the host often must be shut down or forced to rescan/reload the
modified binary. Kronos VST collapses this loop to near-instant by compiling
user code *inside the running host*.

### How it works

- **VST 3 host, JIT compiler inside.** Kronos VST conforms to VST 3 and embeds the
  entire **Kronos** compiler. The plugin acts as the *compiler driver*: it feeds
  source typed into the plugin UI to a **just-in-time (JIT) compiler** (LLVM
  backend) that emits native machine code and wires it into the VST
  infrastructure.
- **Functional, signal-oriented language.** Kronos is a purely functional,
  statically typed, side-effect-free, deterministic language (closest relative:
  **FAUST**). These constraints let the compiler apply far more aggressive
  transformations than a C++ compiler safely could.
- **No chronology / unified signal model.** Programs describe *data flow*, not a
  time order. Each data flow is semantically synchronous: an input update triggers
  recomputation of everything depending on it. Special `z-1`/delay primitives
  connect to previous frames to build recursion and delay lines.
- **Signal-rate factorization.** Because inputs and their dependent data flows are
  known, the compiler factorizes the program by input and generates separate
  **update entry points** — one per "clock source." An audio sample frame and a
  MIDI event are both just entry points. This solves the classic **multirate
  problem** (audio-rate vs. control-rate vs. event-rate) uniformly, with no
  runtime cost because code is generated on the fly.

### VST integration specifics

- **Audio I/O** is exposed to user code as functions: `IO:Audio-In` (a tuple of
  main-bus input channels), `IO:Audio-Sidechain` (sidechain bus). The user's
  `Main` function returns the output frame; output channel count is inferred from
  it.
- **Parameters** come from `IO:Parameter(label, min, default, max)`. Any external
  input carrying the right label/range metadata is treated by the base plugin as
  an automatable parameter and drawn as a slider. Parameter updates are given
  **lower reactive priority** than audio, so UI changes don't spawn extra output
  clock ticks — they "terminate" where they merge into the audio path (analogous
  to hand-caching filter coefficients).
- **MIDI** is an event stream with priority *between* parameters and audio (MIDI
  overrides parameter updates but yields to audio). MIDI is packed into a 32-bit
  int; `Reactive:Gate`/`Reactive:Merge` route note-on/off/CC streams via the
  dynamic-clock mechanism.
- **Multichannel polymorphism.** `Frame:Cons` packs N channels into one frame with
  vector arithmetic, and implicit scalar→multichannel coercion means most
  algorithms run unchanged on mono or multichannel signals; the compiler allocates
  per-channel delay/filter state automatically.

### Use cases

- **Rapid prototyping** — audition DSP changes instantly, then optionally export
  the finished module as C-callable object code for a production project.
- **Live coding** — modify the running signal processor as performance, requiring
  near-instant, error-tolerant recompilation.

Related programmable systems surveyed in the paper: modular synths (Arturia Moog
Modular, **Native Instruments Reaktor**, **Max/MSP** via Pluggo / Max for Live),
and language-embedding tools (**CSoundVST**, **Cabbage**, **FAUST**/libfaust,
Simulink-to-VST generators).

---

## 7. Networked & AI Plugins: HARP 2.0

`2503.02977v1.pdf` — Benetatos et al., ISMIR 2024 LBD. HARP puts **deep-learning
models into the DAW** via **hosted, asynchronous, remote processing**.

### Core idea

Deep-learning audio models are usually shipped as code repos or standalone apps,
disconnected from DAW workflows. HARP bridges this by letting a plugin route audio
(or MIDI) out to **any compatible Gradio endpoint**, run an arbitrary
transformation remotely, and render the results back **in-plugin** — the user
never leaves the DAW. Model developers wrap a standard audio-producing Gradio app
with the lightweight **`pyharp`** API, adding HARP compatibility in only a few
lines. HARP renders endpoint-defined controls dynamically once a user selects an
endpoint.

### Why "asynchronous" and "remote" matter architecturally

Real-time plugin callbacks (Sections 2.1–2.2) cannot host a heavy neural network:
inference is far too slow and non-deterministic for the audio deadline. HARP
sidesteps this entirely:

- **Not a real-time effect.** HARP operates as a **sample editor** invoked on a
  selection, not an inline real-time processor. Processing is **asynchronous** —
  request, wait, receive — decoupled from playback.
- **Remote compute.** The model runs on a Gradio server (local or remote),
  reached via simple **curl API queries** (HARP 2.0 removed the bundled Gradio
  Python client, simplifying installation).

### From ARA plugin to standalone sample editor

HARP originally used **ARA (Audio Random Access)**, which gives a plugin access to
the host's full audio timeline (not just streamed blocks) — ideal for offline,
whole-file analysis/transformation. Because ARA support is inconsistent across
DAWs, HARP 2.0 **migrated to a standalone sample-editor application** that most
DAWs can launch as an external editor, preserving the interaction model while
gaining Windows/Linux support alongside macOS.

### 2.0 features

- **MIDI models** — consume/produce MIDI files, with a built-in piano-roll display
  and MIDI playback.
- **Labeling models** — overlay time-stamped output labels on the media display
  (with duration, description, vertical placement by amplitude/pitch, and color),
  enabling analysis tasks like transcription and similarity/influence attribution.
- **UX/stability** — endpoint dropdown menu, hover "info" and endpoint "status"
  boxes, redesigned error handling, and undo/redo across model iterations.

HARP is relevant here as the reference pattern for **plugins as thin clients to
remote services** — a natural fit for a web-first, server-backed DAW where heavy
processing lives on the backend rather than on the audio thread.

---

## 8. Comparison Across Standards

| System | Domain | Packaging / discovery | Audio-thread model | Extensibility | Language(s) |
|---|---|---|---|---|---|
| **VST 3** | Native | DLL/bundle/package; scanned folders; `GetPluginFactory` | `IAudioProcessor::process` | Versioned interfaces (`FUnknown`/COM-like) | C++ |
| **AU / AAX** | Native | OS/DAW-specific | Real-time render callback | Vendor-defined | C/C++/Obj-C |
| **LV2** | Native (open) | Bundles + Turtle metadata; URI-identified | Simple `run()` core | **Extensions** (core + optional features) | C (bindings for others) |
| **CLAP** | Native (open) | `.clap` module; factory + plugin-id | `process` with typed event queues | **Extensions** (host/plugin negotiated) | C |
| **JUCE** | Cross-format | Wraps VST/VST3/AU/AAX/LV2/Standalone/Unity | `processBlock` | Via target format | C++ |
| **WAM 2.0** | Web | URI + JSON descriptor + ES module | AudioWorklet (`WamNode`/`WamProcessor`) | SDK classes + `WamEnv`/`WamGroup` | JS/TS + WASM (C/C++/FAUST/Csound) |
| **Kronos VST** | Native (programmable) | VST 3 module; user code JIT-compiled | Reactive data-flow, signal-rate factorization | User replaces the DSP itself | Kronos (functional) |
| **HARP 2.0** | AI / networked | Standalone editor + Gradio endpoints (URI) | Asynchronous / offline (not real-time) | Any Gradio model via `pyharp` | Python (models) |

### Cross-cutting themes

- **The real-time deadline drives everything.** Native and web standards both
  isolate a high-priority audio thread with strict no-allocation/no-blocking
  rules. Systems that can't meet the deadline (HARP) deliberately go
  asynchronous/offline instead.
- **The four core duties are universal** — audio blocks, parameters, MIDI/events,
  and state — differing mainly in ABI and packaging.
- **Sample-accurate event scheduling** recurs everywhere (VST 3 change queues,
  WAM `WamEvent`, Kronos reactive clocks).
- **Discovery is either folder-scan (native) or URI/descriptor (web).**
- **Abstraction over implementation** — VST-MA's `FUnknown`, JUCE's
  `AudioProcessor`, and WAM's single-node facade all hide internal complexity
  behind one stable interface so hosts and plugins interoperate.

---

## 9. Relevance to `git-for-music`

For a web-native, collaborative DAW the most directly applicable models are:

- **WAM 2.0** — a browser-native plugin standard with URI-based discovery,
  AudioWorklet processing, group/event routing suited to multi-user sessions, and
  sample-accurate parameter automation. Its `WamEnv`/`WamGroup` split is a
  reference for isolating each collaborator's or subhost's plugin set.
- **HARP-style remote processing** — the pattern for offloading heavy/AI DSP to
  the server rather than the audio thread, matching a server-backed architecture.
- **State management** as a first-class contract — every standard mandates
  save/restore of full plugin state, which aligns with this project's versioning
  goals (parameter state as serializable, diffable data).

---

## References

1. C. Benetatos, F. Cwitkowitz, N. Pruyne, H. F. Garcia, P. O'Reilly, Z. Duan, B. Pardo. "HARP 2.0: Expanding Hosted, Asynchronous, Remote Processing for Deep Learning in the DAW." ISMIR 2024 Late-Breaking/Demo. `docs/papers/daw-plugins/2503.02977v1.pdf`.
2. M. Buffa, S. Ren, O. Campbell, T. Burns, S. Yi, J. Kleimola, O. Larkin. "Web Audio Modules 2.0: An Open Web Audio Plugin Standard." WWW '22 Companion. DOI 10.1145/3487553.3524225. `docs/papers/daw-plugins/3487553.3524225.pdf`.
3. V. Norilo. "Kronos VST — The Programmable Effect Plugin." DAFx-13. `docs/papers/daw-plugins/43.dafx2013_submission_52.pdf`.
4. M. Buffa et al. "Towards an open Web Audio plugin standard." WWW 2018 Companion. DOI 10.1145/3184558.3188737.
5. LV2 project. https://lv2plug.in/
6. Steinberg. "VST Module Architecture." VST 3 Developer Portal.
7. Steinberg. "VST 3 API Documentation." VST 3 Developer Portal.
8. Steinberg. "How the host will load a VST-MA based Plug-in." VST 3 Developer Portal.
9. JUCE. `juce::AudioProcessor` Class Reference. https://docs.juce.com/master/classjuce_1_1AudioProcessor.html
10. Apple. "Audio Unit Programming Guide" — spec-conforming audio units still require testing across commercial hosts. Apple Developer documentation.
11. N. Blair. Thesis on real-time audio-thread safety — why locks, system calls, allocation, and some library calls glitch audio on the audio thread.
12. CLAP — CLever Audio Plug-in API. https://cleveraudio.org/
