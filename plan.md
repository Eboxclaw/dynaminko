INKO Trading Journal

1. The Core Philosophy: The "Duolingo" of Trading
Traditional trading journals suffer from low retention because they are treated strictly as utility tools—they are
boring, time-consuming, and rely heavily on manual data entry. To solve this, the INKO Trading Journal flips
the paradigm. It acts as an alarm and incentive layer first, and a teaching/accounting layer second.
If users are not incentivized to open the app, they will neither log their trades nor learn from their habits.
Therefore, the primary business logic is driven by interactivity, targeted notifications, and a highly gamified UI/
UX that rewards engagement.
2. Synergistic Input Layers
To remove the friction of journaling, data entry is broken down into three distinct, interconnected layers:
A. Manual Input (The "Thesis" Layer)
Manual entry is stripped of tedious accounting. Instead, it is strictly focused on the trader's thesis, "shower
thoughts," or quick ticker ideas. Users document the why before the trade even happens.
B. Auto-Fetched Input (The "Action" Layer)
The core journal is built passively from the user's on-chain actions. By connecting wallets and monitoring
exchange APIs, new trades are fetched and inserted daily. This separates execution from accounting—users
don't have to chase their trades to log them.
C. Assisted Input (The "AI Concierge" Layer)
When new auto-fetched actions arrive, they trigger an event-driven AI workflow. A deterministic personal
assistant reaches out to the user to reconcile the fetched trades with the earlier manual thesis. This creates a
complete journal entry with minimal friction.

Architecture Note: The local AI framework splits responsibilities. A deterministic personal
assistant handles the strict journaling and routine setup, ensuring accounting accuracy.
Simultaneously, a separate sentiment/meme agent processes external community
feedback and market sentiment to provide context to the trades. Product Vision, UI/UX Architecture, and Development Roadmap

3. The "Dynamic Performance" Metric
Standard PNL (Profit & Loss) is insufficient for evaluating trader growth. INKO introduces the Dynamic
Performance Status Graph. This multi-axis visualization evaluates trades across several vectors:
Financial Performance: Raw ROI and risk-adjusted returns.
Thesis Alignment: Did the execution match the original manual thesis?
Sentiment & Ecosystem: Community feedback and broader market mood during the trade.
Psychological Factors: Self-reported or AI-inferred emotional states (e.g., FOMO, conviction).
4. UI/UX & Platform Architecture

The application will be deployed as a Progressive Web App (PWA) on Inkchain, heavily themed around
"INKO the meme" to foster community alignment.
Persistent Bottom Bar: The primary navigation is anchored at the bottom of the screen for one-handed
mobile use.
Multi-modal FAB (Floating Action Button): A centralized action button that expands to offer instant input
methods: AI chat, text logging, image/chart upload, and voice transcription for quick thesis capturing.
Event-Driven Prompts: Push notifications that act as "check-ins" (e.g., "INKO noticed you bought $XYZ.
Was this based on your thesis from Tuesday?").
5. Development Roadmap
To ensure a smooth rollout, the product will be developed in distinct phases, eventually evolving from an
accounting tool into a complete decentralized execution environment.
Phase 1: The Gamified Journal (Current Focus)
Establish the PWA on Inkchain. Build the multi-modal FAB, wallet connection for auto-fetching trades,
and the dual-agent AI system (deterministic assistant + sentiment meme agent). Launch the Dynamic
Performance metric.

Phase 2: Execution & Framework Integration
Transition from a passive journal to an active trading terminal. Introduce Nado Builder cores and
integrate with swap layers. This allows users to journal and
execute from a single, unified interface.
•

Phase 3: Advanced Vaults
Roll out Tydro vaults for automated strategy deployment, utilizing the historical data gathered in Phase 1
to train personalized, local trading agents.
