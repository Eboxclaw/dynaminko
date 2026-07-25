Engineering Principles

| Principle    | Rule                                     |
| ------------ | ---------------------------------------- |
| Architecture | Browser-first, local-first               |
| Dependencies | Prefer zero/minimal dependencies         |
| Data Flow    | Zero-copy where possible                 |
| Concurrency  | Everything async, worker-based           |
| Performance  | Measure before optimizing                |
| Packages     | Small, composable, single responsibility |
| WASM         | Only for CPU-intensive workloads         |
| Browser APIs | Prefer native APIs over libraries        |

Browser Philosophy
Browser is the OS
Prefer native capabilities before adding dependencies.

| Native API       | Purpose                |
| ---------------- | ---------------------- |
| Web Workers      | Parallelism            |
| Streams          | Incremental processing |
| Web Crypto       | Cryptography           |
| IndexedDB        | Metadata               |
| OPFS             | Persistent files       |
| Cache API        | Assets & model caching |
| BroadcastChannel | Cross-tab messaging    |
| WebGPU           | AI & compute           |
| WebSockets       | Realtime communication |

Workers

React UI
    │
    
Typed Message Bus
    │

│        │        │        │
Market   AI    Storage   Risk
Worker  Worker  Worker   Worker

| Worker       | Responsibility       |
| ------------ | -------------------- |
| Market       | Market feeds         |
| AI           | LLM, embeddings      |
| Storage      | Persistence & crypto |
| Risk         | Calculations         |
| Notification | Alerts               |


WASM

TypeScript
      │
High-level orchestration
      │
WebAssembly
      │
GPU or CPU-intensive work

| Worker       | Responsibility       |
| ------------ | -------------------- |
| Market       | Market feeds         |
| AI           | LLM, embeddings      |
| Storage      | Persistence & crypto |
| Risk         | Calculations         |
| Notification | Alerts               |

Data
Never serialize large binary data between workers

SharedArrayBuffer
      ↓
ArrayBuffer
      ↓
Uint8Array
      ↓
JSON (network only)

Async Model

Everything should be non-blocking.

Prefer:

Workers
Streams
Promises
Incremental rendering
Streaming inference

Avoid synchronous work on the main thread.

Lazy Loading
App Shell
    ↓
UI
    ↓
User Action
    ↓
Download Model
    ↓
Warm Model
Never block startup on AI models

TypeScript Responsibilities

TypeScript owns:

UI
Routing
Browser APIs
Workers
State
Networking
Service Workers
PWA lifecycle
Orchestration
WebAssembly Responsibilities

WASM owns:

Cryptography
Parsing
SIMD workloads
Compression
Tokenization
Numerical algorithms
Performance-critical code
Internal Communication
Use	Format
Network	JSON
Workers	Typed messages
Binary	Uint8Array
Shared data	SharedArrayBuffer
Serialization	MessagePack (optional)
Optimization Priorities
Move less data.
Avoid blocking the UI.
Reduce allocations.
Reduce copies.
Stream instead of buffering.
Lazy-load heavy resources.
Benchmark before introducing WASM.
Long-Term Focus
Area	Importance
TypeScript	★★★★★
Browser APIs	★★★★★
PWAs	★★★★★
Workers	★★★★★
WebAssembly	★★★★☆
WebGPU	★★★★☆
Networking	★★★★☆
Cryptography	★★★★☆
Rust	★★★☆☆ (performance modules only)

