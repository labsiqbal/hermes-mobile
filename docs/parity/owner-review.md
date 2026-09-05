# Review the mobile replacement candidates

These are interactive design prototypes with fictional, local-only state. They are not a second gateway client. A simulated send, approval, schedule edit or configuration change never reaches Hermes.

Open `design/parity-compare/index.html`, then open either candidate full-screen for phone testing. Both candidates use the same example work so navigation—not different demo content—drives the comparison.

## What differs

- **Shell:** persistent root navigation, Home overview, contextual detail pages.
- **Workspace:** hierarchical workspace navigation, no persistent bottom tab bar.

The current application is unchanged. Choosing a candidate approves a design direction, not an immediate runtime cutover or native-feature implementation.

## Try these without instructions from the agent

1. Resume the recent conversation. Identify its gateway and profile.
2. Type a multiline draft; inspect a file and its preview; return and check the draft.
3. From that conversation, open a bot's chat and type a different draft. Go Back to Bots, then use browser Back once more. Check that the original conversation and its own draft return—not the bot's draft.
4. Find a pending approval. Read the target, inspect the action, cancel once, then make a simulated decision.
5. Find a scheduled job; identify its profile and timezone. Distinguish the job from current running activity.
6. Find the settings for capabilities, then switch to a simulated unavailable gateway. Check that the original workspace remains selected.
7. Use the state-preview control to try offline/error/empty. Confirm it is clear which data is only an example and whether actions are disabled.
8. Find Git, terminal and browser tools. Check that native/bridge limitations are stated rather than shown as working connections.

## Choose by work, not by skin

Record for each candidate:

| Question | Shell | Workspace |
|---|---|---|
| Can I tell which machine/profile owns my action? | | |
| Can I resume work without hunting? | | |
| Can I find advanced features without memorizing menus? | | |
| Does Back return where I expect? | | |
| Are the text and targets comfortable on my actual phone? | | |
| Is offline/blocked behavior honest and understandable? | | |
| Which interaction felt confusing? | | |

No scores are pre-filled. Chrome screenshots and scripted checks cannot answer your preference or prove real iOS/Android keyboard/background behavior.

## Owner decision

Choose Shell, Workspace, or a concrete revision. If combining ideas, name the source flow (for example Shell's Home with Workspace's contextual tools), rather than requesting an unbounded third redesign.

After a direction is approved, app implementation proceeds by feature tickets. Literal Desktop-native operations, privileged bridges, new services, credential handling, live mutation testing and production cutover retain separate approval gates.
