# 👁 HindSight

Real-time logical fallacy detector for Mentra Live smart glasses. Listens to conversations, detects fallacies using Claude AI, and whispers the fallacy name in your ear through the glasses speaker.

## What It Does

- Transcribes conversation in real time via the glasses microphone
- Checks each utterance for logical fallacies using Claude Haiku
- Speaks the fallacy name through the glasses speaker when one is detected
- Flashes red LED on fallacy, green LED on clean speech
- Shows live transcript + fallacies in a web UI accessible from the Mentra app
- Short press button → spoken count of utterances and fallacies
- Long press button → saves full transcript with reasoning to disk

## Requirements

- [Mentra Live glasses](https://mentraglass.com/live)
- [Mentra app](https://mentraglass.com/os) on iOS or Android
- A VPS or server with a public domain and HTTPS
- [Bun](https://bun.sh) runtime
- Anthropic API key
- MentraOS API key (from [console.mentraglass.com](https://console.mentraglass.com))

## Setup

### 1. Clone and install

```bash
git clone https://github.com/matt-desmarais/hindsight.git
cd hindsight
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
nano .env
```

Fill in:
```
MENTRAOS_API_KEY=your_key_from_console_mentraglass_com
ANTHROPIC_API_KEY=your_anthropic_key
PORT=3000
```

### 3. Register in Mentra Developer Console

1. Go to [console.mentraglass.com](https://console.mentraglass.com)
2. Create App with package name `com.yourname.hindsight`
3. Set Public URL to `https://yourdomain.com`
4. Add **Microphone** permission
5. Set Webview URL to `https://yourdomain.com/ui`

### 4. Configure Apache reverse proxy

In your SSL virtual host config:

```apache
# HindSight webview
ProxyPass /ui http://localhost:3001/ui
ProxyPassReverse /ui http://localhost:3001/ui

# WebSocket support for MentraOS
RewriteEngine On
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^/?(.*) ws://localhost:3000/$1 [P,L]

# MentraOS app server
ProxyPass / http://localhost:3000/
ProxyPassReverse / http://localhost:3000/
```

### 5. Run with systemd

```bash
sudo cp hindsight.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hindsight
sudo systemctl start hindsight
```

Or run directly:
```bash
bun run index.ts
```

## Button Controls

| Press | Action |
|-------|--------|
| Short press | Spoken summary: "X utterances, Y fallacies detected" |
| Long press | Saves transcript to `./transcripts/` and says "Transcript saved" |

## Transcript Files

Saved to `./transcripts/` on long press or session end:

```
[1] [2026-02-22T21:57:01.000Z] You can't trust him, he dropped out of college.
  [FALLACY: Ad Hominem]
  [REASONING: Attacks the person's background rather than their argument.]

[2] [2026-02-22T21:57:14.000Z] The weather is nice today.
```

## Project Structure

```
hindsight/
├── index.ts          # Main app
├── package.json
├── tsconfig.json
├── .env.example
├── hindsight.service # systemd unit file
└── transcripts/      # Auto-created, saved transcripts
```

## License

MIT
