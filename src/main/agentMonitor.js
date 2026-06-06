// ---------------------------------------------------------------------------
// agentMonitor.js — watch AI coding agents and mirror their mood on the cat.
//
// We poll `ps` for processes whose command line mentions one of our patterns
// (e.g. "claude" for the Claude Code CLI, "antigravity" for the Antigravity
// IDE). If any is burning CPU above the threshold we treat the agent as
// "thinking" and the cat shows its focused face. When the busy agent settles
// back down (thinking -> idle) the cat does a happy hop to celebrate the
// finished task.
//
// Purely local: this only ever reads the local process table via `ps`.
// ---------------------------------------------------------------------------

const { exec } = require('child_process');
const { AGENT } = require('./config');

function sampleAgentCpu() {
  return new Promise((resolve) => {
    // %cpu can exceed 100 on multi-core machines; that's fine for our threshold.
    exec('ps -axo %cpu=,command=', { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve(0);

      const patterns = AGENT.PROCESS_PATTERNS.map((p) => p.toLowerCase());
      let maxCpu = 0;
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sp = trimmed.indexOf(' ');
        if (sp < 0) continue;
        const cpu = parseFloat(trimmed.slice(0, sp));
        const cmd = trimmed.slice(sp + 1).toLowerCase();
        if (Number.isNaN(cpu)) continue;
        // Ignore our own process so MeowDesk never watches itself.
        if (cmd.includes('meowdesk')) continue;
        if (patterns.some((p) => cmd.includes(p))) {
          if (cpu > maxCpu) maxCpu = cpu;
        }
      }
      resolve(maxCpu);
    });
  });
}

function startAgentMonitor(brain) {
  let wasThinking = false;

  async function poll() {
    const cpu = await sampleAgentCpu();
    const thinking = cpu > AGENT.CPU_THRESHOLD;
    brain.setAgentThinking(thinking);

    // Transition busy -> calm means the agent just finished: celebrate.
    if (wasThinking && !thinking) {
      brain.playOnce('happy', 700);
    }
    wasThinking = thinking;
  }

  poll();
  const timer = setInterval(poll, AGENT.POLL_MS);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { startAgentMonitor };
