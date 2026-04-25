# LIFEGRID Citizen App – UI Architecture
## Premium Mobile UI · Black & White · Emergency-First

---

## Component Hierarchy

```
App
└── AppShell                          ← Root layout container
    ├── OfflineBanner                 ← Conditional offline indicator
    ├── [AnimatePresence]             ← Screen transition wrapper
    │   ├── HomeScreen                ← Tab: home
    │   ├── TrackScreen               ← Tab: track
    │   ├── ChatScreen                ← Tab: chat
    │   ├── ReportScreen              ← Tab: report
    │   └── AlertsScreen              ← Tab: alerts
    └── BottomNav                     ← Fixed bottom navigation

── HomeScreen ──────────────────────────────────────────────────
HomeScreen
├── StatusBar (header)
│   ├── Brand logo + name
│   ├── Network indicator (Wifi/WifiOff)
│   └── LanguageSelector (compact)
├── SystemStatusBar | ActiveIncidentBanner
├── SOS Button Zone
│   ├── SOS ring animations (×3, staggered)
│   ├── Hold progress SVG ring
│   ├── SOSButton (main interactive element)
│   └── CountdownOverlay (AnimatePresence)
│       ├── SVG countdown ring
│       ├── Countdown number
│       └── Cancel button
├── Instruction text (animated per state)
└── Quick Actions
    ├── VoiceCommandButton
    │   └── VoiceWaveform (animated bars)
    └── CallEmergencyLink (tel:911)

── TrackScreen ─────────────────────────────────────────────────
TrackScreen
├── ScreenHeader (title + status badge)
├── [NoIncidentState] | [TrackingLayout]
│   ├── MapContainer (Leaflet, 55% height)
│   │   ├── TileLayer (OSM dark)
│   │   ├── MapAutoCenter (effect hook)
│   │   ├── Marker (incident location, red dot)
│   │   ├── Circle (incident zone)
│   │   ├── Marker[] (responder positions, colored dots)
│   │   └── MapVignette (CSS overlay)
│   ├── ETAOverlay (absolute, bottom of map)
│   └── TimelinePanel (scrollable, 45% height)
│       ├── CollapseToggle
│       ├── TimelineRow[] (7 steps)
│       │   ├── ConnectorDot (complete/active/pending)
│       │   ├── StepName
│       │   └── Timestamp | ProgressIndicator
│       └── EmergencyCallLink
└── ResponderSheet (AnimatePresence, slide-up)
    ├── SheetOverlay (backdrop)
    ├── SheetHandle
    └── ResponderInfo (type, ID, ETA, status)

── ChatScreen ──────────────────────────────────────────────────
ChatScreen
├── ScreenHeader
│   ├── Title + connection status
│   ├── VoiceToggle (TTS on/off)
│   └── LanguageSelector
├── MessageList (scrollable, aria-live)
│   ├── [EmptyState] | MessageBubble[]
│   │   ├── TimestampDivider (conditional)
│   │   ├── RoleLabel (system/operator)
│   │   └── BubbleContent (system | user style)
│   └── TypingIndicator (AnimatePresence)
│       └── TypingDots (3 animated dots)
├── ScrollToBottomButton (AnimatePresence)
├── QuickRepliesBar (horizontal scroll)
│   └── QuickReplyChip[]
└── InputBar
    ├── VoiceMicButton (toggle)
    ├── TextArea (auto-resize, voice transcript)
    └── SendButton

── ReportScreen ────────────────────────────────────────────────
ReportScreen
├── ScreenHeader (back button + step dots)
├── ProgressBar (animated fill)
├── StepContent (AnimatePresence, slide transition)
│   ├── StepType (step 0)
│   │   └── IncidentTypeGrid (2-col, 8 types)
│   │       └── TypeCard[] (icon + label + check)
│   ├── StepDescribe (step 1)
│   │   ├── VoiceInputButton
│   │   ├── TranscriptPreview (live)
│   │   └── DescriptionTextarea (2000 char limit)
│   ├── StepLocation (step 2)
│   │   ├── GPSStatusCard (auto-acquired)
│   │   └── ManualAddressInput
│   └── StepConfirm (step 3)
│       ├── SummaryCard (type + description + location)
│       ├── OfflineWarning (conditional)
│       └── LegalNotice
└── NavigationBar
    ├── BackButton (step > 0)
    └── ContinueButton | SubmitButton

── AlertsScreen ────────────────────────────────────────────────
AlertsScreen
├── ScreenHeader (title + unread count + mark-all-read)
├── CriticalBanner (AnimatePresence, conditional)
├── SourceFilterBar (horizontal scroll)
│   └── FilterPill[] (ALL, FLOOD, WEATHER, SECURITY, SENSOR, SYSTEM)
├── AlertList (scrollable)
│   └── AlertRow[] (severity border + icon + content)
│       ├── SourceIcon
│       ├── AlertTitle (bold if unread)
│       ├── UnreadDot (conditional)
│       ├── Description (2-line clamp)
│       └── MetaRow (severity badge + location + time)
└── AlertDetailSheet (AnimatePresence, slide-up)
    ├── SheetOverlay
    ├── SheetHandle
    ├── AlertHeader (icon + title + severity)
    ├── Description (full)
    ├── Location
    ├── RecommendedActions (numbered list)
    └── Timestamp
```

---

## UX Behavior Logic

### SOS Button State Machine

```
idle
 │
 ├─[pointer down]──────────────────► holding
 │                                      │
 │                                      ├─[pointer up before 2s]──► idle
 │                                      │
 │                                      └─[2s elapsed]──────────────► confirming
 │                                                                        │
 │                                                                        ├─[cancel tap]──► idle
 │                                                                        │
 │                                                                        └─[3s countdown]─► submitting
 │                                                                                              │
 │                                                                                              ├─[success]──► active
 │                                                                                              │
 │                                                                                              └─[error]────► idle
 │
 └─[voice "SOS"]────────────────────► confirming (skip holding)
```

### Hold Mechanics
- `setInterval` at 16ms (60fps) tracks elapsed time
- SVG `strokeDashoffset` animates the progress ring in real time
- `scale(1.04)` spring animation on the button during hold
- Haptic: `tap` on start, `success` on complete, `tap` on cancel

### Confirmation Countdown
- 3-second SVG ring countdown
- `tick` haptic each second
- Auto-submits at 0 — no user action required
- Cancel button always visible

### Voice Command
- Web Speech API, continuous mode off (single utterance)
- Trigger words: `sos`, `emergency`, `help`, `ayuda`, `urgence`, `مساعدة`, `救命`
- On final transcript match → skip to `confirming` state
- TTS reads back: "Help is on the way. Stay calm."

### Offline Behavior
```
isOnline = false
  │
  ├─ SOS submit → enqueueOffline({ type: 'SOS', payload })
  │               → setActiveIncident('offline-{ts}', 'OFFLINE-SOS')
  │               → navigate to track tab
  │               → show "Queued" state
  │
  ├─ Report submit → enqueueOffline({ type: 'REPORT', payload })
  │                  → show "Queued" confirmation
  │
  └─ Back online → useOffline hook flushes queue
                   → POST each item to API
                   → dequeueOffline on success
```

### Navigation Transitions
- Tab switch: `opacity 0→1, x 20→0` (180ms ease-out)
- Sheet open: `y 100%→0` (spring, stiffness 400, damping 35)
- Sheet close: `y 0→100%`
- Step advance: `opacity 0→1, x 30→0` (200ms)
- Step back: `opacity 0→1, x -30→0`

### Chat Auto-behaviors
- New message → `scrollIntoView({ behavior: 'smooth' })`
- TTS: if `isVoiceActive` and new system/operator message → `speak(content, language)`
- Typing indicator: shown when `isChatTyping` is true (set by WebSocket event)
- Quick replies: horizontal scroll, tap sends immediately

### Alert Severity Visual System
```
CRITICAL → left border #ff2d2d + persistent banner
HIGH     → left border #ff8c00
MEDIUM   → left border #ffd700
LOW      → left border #00ff88
```

### Responder Dot Colors (map)
```
AMBULANCE     → #00ff88 (green)
FIRE          → #ff8c00 (orange)
POLICE        → #00aaff (blue)
HAZMAT        → #ffd700 (yellow)
SEARCH_RESCUE → #ffffff (white)
MILITARY      → #888888 (gray)
```

---

## Design Token Reference

```css
/* Colors */
--color-bg:         #000000   /* Pure black background */
--color-surface:    #0a0a0a   /* Card/panel background */
--color-surface-2:  #111111   /* Elevated surface */
--color-surface-3:  #1a1a1a   /* Highest elevation */
--color-border:     #222222   /* Default border */
--color-border-2:   #333333   /* Emphasized border */
--color-text:       #ffffff   /* Primary text */
--color-text-muted: #888888   /* Secondary text */
--color-text-dim:   #555555   /* Tertiary text */

/* Severity */
--color-critical:   #ff2d2d
--color-high:       #ff8c00
--color-medium:     #ffd700
--color-low:        #00ff88
--color-info:       #00aaff

/* Typography */
--font-sans: 'Inter', 'Helvetica Neue', Arial, sans-serif
--font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace

/* Layout */
--nav-height:    64px
--header-height: 56px
--sos-size:      160px
--safe-top:      env(safe-area-inset-top, 0px)
--safe-bottom:   env(safe-area-inset-bottom, 0px)

/* Motion */
--spring:   cubic-bezier(0.34, 1.56, 0.64, 1)   /* Bouncy */
--ease-out: cubic-bezier(0.0, 0.0, 0.2, 1)       /* Smooth */
```

---

## Accessibility

- All interactive elements have `aria-label`
- SOS button: `aria-pressed`, `aria-label="SOS Emergency Button — hold for 2 seconds"`
- Message list: `role="log"`, `aria-live="polite"`
- Navigation: `role="navigation"`, `aria-current="page"` on active tab
- Critical banner: `role="alert"`, `aria-live="assertive"`
- `prefers-reduced-motion`: all animations disabled
- Minimum touch target: 44×44px (all buttons)
- Color is never the sole indicator (always paired with text/icon)

---

## Offline Fallback Mode

```
Network lost
    │
    ├── OfflineBanner appears (yellow, top of screen)
    ├── SOS → queued to localStorage via Zustand persist
    ├── Report → queued to localStorage
    ├── Chat → messages stored locally, send queued
    ├── Map → last known positions shown (staleness indicator)
    └── Alerts → cached alerts shown from localStorage

Network restored
    │
    ├── OfflineBanner disappears
    ├── useOffline hook detects online event
    ├── Flushes offlineQueue (POST each item)
    └── Dequeues on success
```

---

## Screen Layout Proportions (Mobile 390×844)

```
HomeScreen:
  Header:        56px
  Body:          ~732px
    Status bar:  40px
    SOS zone:    ~480px (centered, dominant)
    Quick acts:  ~212px

TrackScreen:
  Header:        56px
  Map:           55% of remaining (~432px)
  Timeline:      45% of remaining (~354px)

ChatScreen:
  Header:        56px
  Messages:      flex-1 (scrollable)
  Quick replies: ~48px
  Input bar:     ~64px

ReportScreen:
  Header:        56px
  Progress bar:  2px
  Step content:  flex-1 (scrollable)
  Nav bar:       ~72px

AlertsScreen:
  Header:        56px
  Critical banner: 0 or ~44px
  Filter bar:    ~52px
  Alert list:    flex-1 (scrollable)
```
