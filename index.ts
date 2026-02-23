import { AppServer, AppSession } from '@mentra/sdk';
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Turn {
  timestamp: Date;
  text: string;
  fallacy: FallacyResult | null;
}

interface FallacyResult {
  name: string;       // spoken aloud through glasses speaker
  reasoning: string;  // saved to transcript file + shown in webview
}

async function checkForFallacy(utterance: string): Promise<FallacyResult | null> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Analyze this statement for logical fallacies: "${utterance}"

Be liberal in your detection - if there's any hint of a logical fallacy, flag it.
Common fallacies to watch for: ad hominem, straw man, false dichotomy, slippery slope,
appeal to authority, appeal to emotion, hasty generalization, circular reasoning,
bandwagon, red herring, false cause, anecdotal evidence.

If there is any logical fallacy, respond in this exact JSON format:
{
  "fallacy": true,
  "name": "<short fallacy name, max 4 words>",
  "reasoning": "<1-2 sentence explanation>"
}

If there is truly no fallacy at all, respond:
{
  "fallacy": false
}

Respond with JSON only. No preamble.`
    }]
  });

  const raw = (response.content[0] as { type: string; text: string }).text
    .trim()
    .replace(/^```json\n?/, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.fallacy) return null;
    return { name: parsed.name, reasoning: parsed.reasoning };
  } catch {
    return null;
  }
}

function saveTranscript(transcript: Turn[], sessionId: string): string {
  const dir = './transcripts';
  fs.mkdirSync(dir, { recursive: true });

  const filename = `hindsight-${sessionId}-${Date.now()}.txt`;
  const filepath = path.join(dir, filename);

  const lines = transcript.map((t, i) => {
    const time = t.timestamp.toISOString();
    const fallacyBlock = t.fallacy
      ? `  [FALLACY: ${t.fallacy.name}]\n  [REASONING: ${t.fallacy.reasoning}]`
      : '';
    return `[${i + 1}] [${time}] ${t.text}${fallacyBlock ? '\n' + fallacyBlock : ''}`;
  });

  fs.writeFileSync(filepath, lines.join('\n\n') + '\n');
  return filepath;
}

class HindSight extends AppServer {
  public transcript: Turn[] = [];

  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string
  ): Promise<void> {

    // Reset transcript on new session
    this.transcript = [];

    const caps = session.capabilities;

    console.log(`\n[HindSight] Session ${sessionId} started`);

    await session.audio.speak('HindSight ready.');

    if (caps?.hasLight) {
      await session.led.turnOn({ color: 'green', ontime: 1500 });
    }


    session.subscribe('transcription');

    session.events.onTranscription(async (data) => {
      const text = data.text.trim();
      if (!text) return;

      if (!data.isFinal) {
        process.stdout.write(`\r... ${text.slice(0, 80).padEnd(80)}`);
        return;
      }

      const time = new Date().toLocaleTimeString();
      console.log(`\n[${time}] ${text}`);

      const turn: Turn = { timestamp: new Date(), text, fallacy: null };
      this.transcript.push(turn);

      console.log(`[HindSight] Checking: "${text}"`);

      checkForFallacy(text).then(async (fallacy) => {
        console.log(`[HindSight] Fallacy result:`, fallacy);
        turn.fallacy = fallacy;

        if (fallacy) {
          console.log(`  → FALLACY: ${fallacy.name}`);
          console.log(`  → ${fallacy.reasoning}`);

          await session.audio.speak(fallacy.name);

          if (caps?.hasLight) {
            await session.led.turnOn({ color: 'red', ontime: 150, offtime: 100, count: 1 });
          }
        } else {
          if (caps?.hasLight) {
            await session.led.turnOn({ color: 'green', ontime: 150, offtime: 100, count: 1 });
          }
        }
      }).catch((err) => {
        console.error('[HindSight] Fallacy check error:', err.message);
      });
    });


    session.events.onDisconnected(() => {
      console.log(`\n[HindSight] Session ${sessionId} ended. ${this.transcript.length} turns.`);
      if (this.transcript.length > 0) {
        const filepath = saveTranscript(this.transcript, sessionId);
        console.log(`[HindSight] Auto-saved to ${filepath}`);
      }
    });
  }
}

// ── Phone webview ─────────────────────────────────────────────────────────────

const hindsight = new HindSight({
  packageName: 'com.mtm.hindsight',
  apiKey: process.env.MENTRAOS_API_KEY || '',
  port: Number(process.env.PORT) || 3000,
});

const expressApp = express();

// Live transcript JSON API
expressApp.get('/ui/api/transcript', (req, res) => {
  res.json(hindsight.transcript ?? []);
});

// Phone UI
expressApp.get('/ui', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HindSight</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #eee; padding: 16px; }
    h1 { color: #f90; font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; }
    .stat { background: #1a1a1a; border-radius: 8px; padding: 10px 16px; flex: 1; text-align: center; }
    .stat-num { font-size: 24px; font-weight: bold; color: #f90; }
    .stat-label { font-size: 11px; color: #666; margin-top: 2px; }
    .fallacy-count .stat-num { color: #f55; }
    .turn { margin-bottom: 14px; background: #1a1a1a; border-radius: 8px; padding: 12px; }
    .turn.has-fallacy { border-left: 3px solid #f55; }
    .text { font-size: 15px; line-height: 1.4; }
    .fallacy-name { color: #f55; font-weight: bold; margin-top: 8px; font-size: 13px; }
    .reasoning { color: #999; font-size: 12px; margin-top: 4px; line-height: 1.4; }
    .time { color: #555; font-size: 11px; margin-top: 6px; }
    .empty { color: #444; text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <h1>👁 HindSight</h1>
  <p class="subtitle">Real-time fallacy detector</p>
  <div class="stats">
    <div class="stat">
      <div class="stat-num" id="count">0</div>
      <div class="stat-label">Utterances</div>
    </div>
    <div class="stat fallacy-count">
      <div class="stat-num" id="fallacies">0</div>
      <div class="stat-label">Fallacies</div>
    </div>
  </div>
  <div id="transcript"><p class="empty">Listening...</p></div>
  <script>
    async function refresh() {
      try {
        const res = await fetch('/ui/api/transcript');
        const turns = await res.json();
        document.getElementById('count').textContent = turns.length;
        document.getElementById('fallacies').textContent = turns.filter(t => t.fallacy).length;
        const el = document.getElementById('transcript');
        if (!turns.length) {
          el.innerHTML = '<p class="empty">Listening...</p>';
          return;
        }
        el.innerHTML = [...turns].reverse().map(t => \`
          <div class="turn \${t.fallacy ? 'has-fallacy' : ''}">
            <div class="text">\${t.text}</div>
            \${t.fallacy ? \`
              <div class="fallacy-name">⚠️ \${t.fallacy.name}</div>
              <div class="reasoning">\${t.fallacy.reasoning}</div>
            \` : ''}
            <div class="time">\${new Date(t.timestamp).toLocaleTimeString()}</div>
          </div>
        \`).join('');
      } catch(e) {}
    }
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`);
});

expressApp.listen(3001, () => {
  console.log('[HindSight] Phone UI at http://localhost:3001');
});

hindsight.start();
console.log('HindSight running...');
